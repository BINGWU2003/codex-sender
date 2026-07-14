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
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thread-1' } } })
  }
  if (message.method === 'turn/start') {
    if (!Array.isArray(message.params.input[0].text_elements)) process.exit(2)
    send({ id: message.id, result: { turn: { id: 'turn-1' } } })
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
  it('requires initialization before starting a thread', async () => {
    const client = new AppServerClient()
    await expect(client.startThread()).rejects.toThrow('尚未完成初始化握手')
  })

  it('performs the handshake and sends a text turn', async () => {
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
      const thread = await client.startThread({ cwd: '/tmp/project' })
      const turn = await client.startTextTurn({
        threadId: thread.thread.id,
        text: 'hello',
        cwd: '/tmp/project',
      })

      expect(initialized.platformFamily).toBe('unix')
      expect(thread.thread.id).toBe('thread-1')
      expect(turn.turn.id).toBe('turn-1')
    }
    finally {
      client.stop()
    }
  })
})
