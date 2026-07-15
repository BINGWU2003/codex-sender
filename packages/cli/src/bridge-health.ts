export interface BridgeHealthOptions {
  expectedVersion: string
  port: number
  timeoutMs?: number
  token: string
}

export interface BridgeHealthReport {
  problem?: string
  running: boolean
  version?: string
  versionMatches: boolean
}

export async function checkBridgeHealth(
  options: BridgeHealthOptions,
  fetchImplementation: typeof fetch = fetch,
): Promise<BridgeHealthReport> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000)

  try {
    const response = await fetchImplementation(`http://127.0.0.1:${options.port}/health`, {
      headers: { 'x-codex-sender-token': options.token },
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        running: true,
        versionMatches: false,
        problem: `Bridge 健康检查失败：HTTP ${response.status}`,
      }
    }

    const body = await response.json() as { version?: unknown }
    const version = typeof body.version === 'string' ? body.version : undefined
    if (!version) {
      return {
        running: true,
        versionMatches: false,
        problem: 'Bridge 未返回有效版本号',
      }
    }

    const versionMatches = version === options.expectedVersion
    return {
      running: true,
      version,
      versionMatches,
      problem: versionMatches
        ? undefined
        : `Bridge 版本 ${version} 与当前 CLI ${options.expectedVersion} 不一致，请重启 Bridge`,
    }
  }
  catch {
    return {
      running: false,
      versionMatches: false,
      problem: `Bridge 未在 127.0.0.1:${options.port} 运行`,
    }
  }
  finally {
    clearTimeout(timeout)
  }
}
