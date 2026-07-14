import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { AppServerClient, parseServerMessage } from '../src/index.js'

const fakeServerScript = `
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
const send = message => process.stdout.write(JSON.stringify(message) + '\\n')
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'linux' } })
  }
  if (message.method === 'thread/list') {
    send({ id: message.id, result: { data: [{ id: 'thread-1', sessionId: 'thread-1', preview: 'hello', ephemeral: false, createdAt: 1, updatedAt: 2, cwd: '/tmp/project', source: 'appServer', status: { type: 'idle' }, name: 'Demo' }], nextCursor: null, backwardsCursor: null } })
  }
})
`

describe('parseServerMessage', () => {
  it('parses a JSONL response', () => {
    expect(parseServerMessage('{"id":1,"result":{"threadId":"thread-1"}}')).toEqual({
      id: 1,
      result: { threadId: 'thread-1' },
    })
  })

  it('rejects non-object messages', () => {
    expect(() => parseServerMessage('[]')).toThrow(TypeError)
  })
})

describe('app server client lifecycle guards', () => {
  it('cleans up after the app-server executable cannot start', async () => {
    const client = new AppServerClient({
      command: path.join(tmpdir(), `missing-codex-${Date.now()}.exe`),
      requestTimeoutMs: 500,
    })

    await expect(client.initialize({ name: 'codex_sender_test', version: '0.0.0' })).rejects.toThrow()
    expect(client.running).toBe(false)
  })

  it('requires initialization before listing threads', async () => {
    const client = new AppServerClient()
    await expect(client.listThreads()).rejects.toThrow('尚未完成初始化握手')
  })

  it('performs the handshake and lists threads', async () => {
    const client = new AppServerClient({
      command: process.execPath,
      args: ['-e', fakeServerScript],
      requestTimeoutMs: 2_000,
    })

    try {
      const initialized = await client.initialize({
        name: 'codex_sender_test',
        version: '0.0.0',
      })
      const threads = await client.listThreads({ cwd: '/tmp/project' })

      expect(initialized.platformFamily).toBe('unix')
      expect(threads.data[0]?.name).toBe('Demo')
    }
    finally {
      client.stop()
    }
  })
})
