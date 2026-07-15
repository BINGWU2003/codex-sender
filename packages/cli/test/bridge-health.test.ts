import { describe, expect, it, vi } from 'vitest'
import { checkBridgeHealth } from '../src/bridge-health.js'

const options = {
  expectedVersion: '0.2.1',
  port: 47_321,
  token: 'test-token',
}

describe('bridge health check', () => {
  it('accepts a running Bridge with the current CLI version', async () => {
    const fetchImplementation = vi.fn(async () => Response.json({ ok: true, version: '0.2.1' }))

    await expect(checkBridgeHealth(options, fetchImplementation)).resolves.toEqual({
      running: true,
      version: '0.2.1',
      versionMatches: true,
      problem: undefined,
    })
  })

  it('reports a stale Bridge version', async () => {
    const fetchImplementation = vi.fn(async () => Response.json({ ok: true, version: '0.1.2' }))

    await expect(checkBridgeHealth(options, fetchImplementation)).resolves.toEqual({
      running: true,
      version: '0.1.2',
      versionMatches: false,
      problem: 'Bridge 版本 0.1.2 与当前 CLI 0.2.1 不一致，请重启 Bridge',
    })
  })

  it('reports an unreachable Bridge', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error('connection refused')
    })

    await expect(checkBridgeHealth(options, fetchImplementation)).resolves.toEqual({
      running: false,
      versionMatches: false,
      problem: 'Bridge 未在 127.0.0.1:47321 运行',
    })
  })
})
