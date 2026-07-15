#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { BridgeServer, initializeDefaultDataDirectory, Logger, StateStore } from '@codex-sender/bridge'
import { checkBridgeHealth } from './bridge-health.js'
import { refreshBridge } from './bridge-lifecycle.js'
import { CursorInstaller } from './cursor-installer.js'
import { runInstallWizard, shouldRunInstallWizard, suggestCursorPath } from './install-wizard.js'
import { readPackageVersion } from './package-info.js'
import { registerStartup, removeStartup } from './startup.js'

const version = await readPackageVersion()

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2)

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(version)
    return
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (!['doctor', 'install', 'logs', 'serve', 'uninstall'].includes(command))
    throw new Error(`未知命令：${command}\n运行 codex-sender help 查看帮助。`)

  const requestedCursorPath = readOption(args, '--cursor-path')
  const requestedPort = readNumberOption(args, '--port')
  const dataDirectory = await initializeDefaultDataDirectory()
  const stateStore = new StateStore({ dataDirectory, defaultPort: requestedPort })

  switch (command) {
    case 'install': {
      const state = await stateStore.load()
      const noStartup = args.includes('--no-startup')
      const cursorPath = await suggestCursorPath(requestedCursorPath, stateStore.dataDirectory)
      const wizardResult = shouldRunInstallWizard(args)
        ? await runInstallWizard({
            allowStartup: !noStartup,
            cursorPath,
            port: requestedPort ?? state.port,
            registerStartup: !noStartup,
          })
        : {
            cursorPath,
            port: requestedPort ?? state.port,
            registerStartup: !noStartup,
          }
      if (!wizardResult)
        return
      const installer = new CursorInstaller({
        dataDirectory: stateStore.dataDirectory,
        cursorPath: wizardResult.cursorPath,
      })
      if (state.port !== wizardResult.port)
        await stateStore.setPort(wizardResult.port)
      const currentState = await stateStore.load()
      const manifest = await installer.install({ port: currentState.port, token: currentState.token, version })
      const cliEntryPath = fileURLToPath(import.meta.url)
      if (wizardResult.registerStartup)
        await registerStartup(cliEntryPath)
      else
        await removeStartup()
      const bridge = await refreshBridge({
        cliEntryPath,
        currentVersion: version,
        existingPorts: [state.port],
        targetPort: currentState.port,
        token: currentState.token,
      })
      console.log(`Codex Sender 已注入 Cursor ${manifest.cursorVersion}`)
      console.log(`Cursor 目录：${manifest.paths.appRoot}`)
      console.log(`Bridge ${bridge.version} 已更新并监听 127.0.0.1:${currentState.port}`)
      console.log('请重新启动 Cursor。')
      break
    }
    case 'uninstall': {
      const installer = new CursorInstaller({
        dataDirectory: stateStore.dataDirectory,
        cursorPath: requestedCursorPath,
      })
      await installer.uninstall()
      await removeStartup()
      console.log('Codex Sender 已从 Cursor 恢复。')
      break
    }
    case 'doctor': {
      const state = await stateStore.load()
      const installer = new CursorInstaller({
        dataDirectory: stateStore.dataDirectory,
        cursorPath: requestedCursorPath,
      })
      const report = await installer.doctor()
      const bridge = await checkBridgeHealth({
        expectedVersion: version,
        port: state.port,
        token: state.token,
      })
      const problems = bridge.problem ? [...report.problems, bridge.problem] : report.problems
      const completeReport = {
        ...report,
        ok: report.ok && bridge.versionMatches,
        bridgeRunning: bridge.running,
        bridgeVersion: bridge.version,
        bridgeVersionMatches: bridge.versionMatches,
        problems,
      }
      console.log(JSON.stringify(completeReport, null, 2))
      if (!completeReport.ok)
        process.exitCode = 1
      break
    }
    case 'logs': {
      const logger = new Logger({ dataDirectory: stateStore.dataDirectory })
      const lines = readPositiveIntegerOption(args, '--lines') ?? 100
      try {
        const content = await readFile(logger.logPath, 'utf8')
        console.log(content.trimEnd().split(/\r?\n/).slice(-lines).join('\n'))
      }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
          throw error
        console.log(`尚未生成日志：${logger.logPath}`)
      }
      break
    }
    case 'serve': {
      const state = await stateStore.load()
      if (requestedPort && state.port !== requestedPort)
        await stateStore.setPort(requestedPort)
      const bridge = new BridgeServer({ stateStore, version })
      const listeningPort = await bridge.start()
      console.log(`Codex Sender bridge 正在监听 127.0.0.1:${listeningPort}`)
      const stop = async (): Promise<void> => {
        await bridge.stop()
        process.exit(0)
      }
      process.once('SIGINT', () => void stop())
      process.once('SIGTERM', () => void stop())
      break
    }
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0)
    return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error(`${name} 缺少参数值`)
  return value
}

function readNumberOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name)
  if (value === undefined)
    return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error(`${name} 必须是 1-65535 之间的整数`)
  return parsed
}

function readPositiveIntegerOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name)
  if (value === undefined)
    return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000)
    throw new Error(`${name} 必须是 1-10000 之间的整数`)
  return parsed
}

function printHelp(): void {
  console.log(`Codex Sender ${version}

用法：
  codex-sender install [--cursor-path PATH] [--port PORT] [--no-startup] [--non-interactive]
  codex-sender doctor [--cursor-path PATH]
  codex-sender logs [--lines COUNT]
  codex-sender serve [--port PORT]
  codex-sender uninstall [--cursor-path PATH]
  codex-sender version

install 可重复执行，并会重新注入 Cursor、替换旧 Bridge 并启动当前版本；使用 --non-interactive 可跳过向导。
安装和恢复 Cursor 时必须先完全退出 Cursor。`)
}
