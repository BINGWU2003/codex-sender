import type { BridgeHealthOptions, BridgeHealthReport } from './bridge-health.js'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { checkBridgeHealth } from './bridge-health.js'
import { startBridgeDetached } from './startup.js'

export interface RefreshBridgeOptions {
  cliEntryPath: string
  currentVersion: string
  existingPorts: number[]
  targetPort: number
  token: string
}

interface BridgeLifecycleDependencies {
  checkHealth?: (options: BridgeHealthOptions) => Promise<BridgeHealthReport>
  delay?: (milliseconds: number) => Promise<void>
  fetch?: typeof fetch
  start?: (cliEntryPath: string) => void
  stopLegacy?: (port: number) => void
}

export async function refreshBridge(
  options: RefreshBridgeOptions,
  dependencies: BridgeLifecycleDependencies = {},
): Promise<BridgeHealthReport> {
  const checkHealth = dependencies.checkHealth ?? checkBridgeHealth
  const delay = dependencies.delay ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const fetchImplementation = dependencies.fetch ?? fetch
  const start = dependencies.start ?? startBridgeDetached
  const stopLegacy = dependencies.stopLegacy ?? stopLegacyWindowsBridge
  const ports = [...new Set([...options.existingPorts, options.targetPort])]

  for (const port of ports) {
    const healthOptions = { expectedVersion: options.currentVersion, port, token: options.token, timeoutMs: 750 }
    const health = await checkHealth(healthOptions)
    if (!health.running)
      continue
    if (!health.version)
      throw new Error(`端口 ${port} 已被无法验证的服务占用，已停止更新 Bridge`)

    await stopBridge({
      checkHealth,
      delay,
      fetchImplementation,
      healthOptions,
      stopLegacy,
    })
  }

  start(options.cliEntryPath)
  const targetHealthOptions = {
    expectedVersion: options.currentVersion,
    port: options.targetPort,
    token: options.token,
    timeoutMs: 750,
  }
  const health = await waitForHealth(targetHealthOptions, checkHealth, delay, report => report.versionMatches)
  if (!health.versionMatches)
    throw new Error(health.problem ?? `Bridge ${options.currentVersion} 启动失败`)
  return health
}

interface StopBridgeOptions {
  checkHealth: (options: BridgeHealthOptions) => Promise<BridgeHealthReport>
  delay: (milliseconds: number) => Promise<void>
  fetchImplementation: typeof fetch
  healthOptions: BridgeHealthOptions
  stopLegacy: (port: number) => void
}

async function stopBridge(options: StopBridgeOptions): Promise<void> {
  let graceful = false
  try {
    const response = await options.fetchImplementation(`http://127.0.0.1:${options.healthOptions.port}/api/shutdown`, {
      method: 'POST',
      headers: { 'x-codex-sender-token': options.healthOptions.token },
      signal: AbortSignal.timeout(2_000),
    })
    if (response.ok)
      graceful = true
    else if (response.status !== 404 && response.status !== 405)
      throw new Error(`Bridge 停止请求失败：HTTP ${response.status}`)
  }
  catch (error) {
    const health = await options.checkHealth(options.healthOptions)
    if (!health.running)
      return
    if (error instanceof Error && error.message.startsWith('Bridge 停止请求失败'))
      throw error
  }

  if (!graceful)
    options.stopLegacy(options.healthOptions.port)

  const health = await waitForHealth(
    options.healthOptions,
    options.checkHealth,
    options.delay,
    report => !report.running,
  )
  if (health.running)
    throw new Error(`旧 Bridge 未能停止：127.0.0.1:${options.healthOptions.port}`)
}

async function waitForHealth(
  options: BridgeHealthOptions,
  checkHealth: (options: BridgeHealthOptions) => Promise<BridgeHealthReport>,
  delay: (milliseconds: number) => Promise<void>,
  done: (report: BridgeHealthReport) => boolean,
): Promise<BridgeHealthReport> {
  let report = await checkHealth(options)
  for (let attempt = 0; attempt < 39 && !done(report); attempt++) {
    await delay(100)
    report = await checkHealth(options)
  }
  return report
}

function stopLegacyWindowsBridge(port: number): void {
  if (process.platform !== 'win32')
    throw new Error('旧 Bridge 不支持自动停止，请先手动结束旧进程')

  const netstat = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
  if (netstat.status !== 0)
    throw new Error(`无法检查旧 Bridge 进程：${netstat.stderr.trim() || 'netstat 失败'}`)
  const processId = parseWindowsListenerPid(netstat.stdout, port)
  if (!processId || processId === process.pid)
    throw new Error(`无法定位监听 127.0.0.1:${port} 的旧 Bridge 进程`)

  const stopped = spawnSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
  if (stopped.status !== 0)
    throw new Error(`无法停止旧 Bridge 进程 ${processId}：${stopped.stderr.trim() || stopped.stdout.trim() || 'taskkill 失败'}`)
}

export function parseWindowsListenerPid(output: string, port: number): number | undefined {
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 5 || fields[0].toUpperCase() !== 'TCP')
      continue
    if (fields[1] !== `127.0.0.1:${port}` || fields[3].toUpperCase() !== 'LISTENING')
      continue
    const processId = Number(fields.at(-1))
    if (Number.isInteger(processId) && processId > 0)
      return processId
  }
  return undefined
}
