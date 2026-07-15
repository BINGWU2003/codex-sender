import type { BridgeHealthReport } from '../src/bridge-health.js'
import { describe, expect, it, vi } from 'vitest'
import { parseWindowsListenerPid, refreshBridge } from '../src/bridge-lifecycle.js'

function running(version: string, matches = false): BridgeHealthReport {
  return {
    running: true,
    version,
    versionMatches: matches,
    problem: matches ? undefined : '旧版本',
  }
}
const stopped: BridgeHealthReport = { running: false, versionMatches: false, problem: '未运行' }

describe('bridge lifecycle', () => {
  it('gracefully replaces a running Bridge and verifies the new version', async () => {
    const checkHealth = vi.fn()
      .mockResolvedValueOnce(running('0.2.1'))
      .mockResolvedValueOnce(stopped)
      .mockResolvedValueOnce(running('0.2.4', true))
    const fetchImplementation = vi.fn(async () => Response.json({ ok: true }))
    const start = vi.fn()
    const stopLegacy = vi.fn()

    await expect(refreshBridge({
      cliEntryPath: 'C:\\cli.mjs',
      currentVersion: '0.2.4',
      existingPorts: [47_321],
      targetPort: 47_321,
      token: 'test-token',
    }, {
      checkHealth,
      delay: async () => {},
      fetch: fetchImplementation,
      start,
      stopLegacy,
    })).resolves.toMatchObject({ version: '0.2.4', versionMatches: true })

    expect(fetchImplementation).toHaveBeenCalledWith('http://127.0.0.1:47321/api/shutdown', expect.objectContaining({
      method: 'POST',
      headers: { 'x-codex-sender-token': 'test-token' },
    }))
    expect(stopLegacy).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith('C:\\cli.mjs')
  })

  it('falls back to the verified listener process for legacy Bridges', async () => {
    const checkHealth = vi.fn()
      .mockResolvedValueOnce(running('0.2.1'))
      .mockResolvedValueOnce(stopped)
      .mockResolvedValueOnce(running('0.2.4', true))
    const stopLegacy = vi.fn()

    await refreshBridge({
      cliEntryPath: 'C:\\cli.mjs',
      currentVersion: '0.2.4',
      existingPorts: [47_321],
      targetPort: 47_321,
      token: 'test-token',
    }, {
      checkHealth,
      delay: async () => {},
      fetch: vi.fn(async () => new Response(null, { status: 404 })),
      start: vi.fn(),
      stopLegacy,
    })

    expect(stopLegacy).toHaveBeenCalledWith(47_321)
  })

  it('does not stop an unverified service occupying the Bridge port', async () => {
    const stopLegacy = vi.fn()
    const start = vi.fn()

    await expect(refreshBridge({
      cliEntryPath: 'C:\\cli.mjs',
      currentVersion: '0.2.4',
      existingPorts: [47_321],
      targetPort: 47_321,
      token: 'test-token',
    }, {
      checkHealth: vi.fn(async () => ({ running: true, versionMatches: false, problem: 'HTTP 401' })),
      delay: async () => {},
      start,
      stopLegacy,
    })).rejects.toThrow('无法验证的服务')

    expect(stopLegacy).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('parses only the requested listening socket from netstat', () => {
    const output = `
  TCP    127.0.0.1:47321       0.0.0.0:0              LISTENING       6360
  TCP    127.0.0.1:47322       127.0.0.1:50000        ESTABLISHED     7000
`
    expect(parseWindowsListenerPid(output, 47_321)).toBe(6360)
    expect(parseWindowsListenerPid(output, 47_322)).toBeUndefined()
  })
})
