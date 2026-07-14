import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { BridgeServer, CodexCliRunner, StateStore } from '../src/index.js'

const fakeCodexScript = `
let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const resumeIndex = process.argv.indexOf('resume')
  const threadId = resumeIndex >= 0 ? process.argv[resumeIndex + 2] : '019f-test-thread'
  process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: threadId }) + '\\n')
  process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n')
})
`

const servers: BridgeServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
})

describe('bridge server', () => {
  it('waits for thread binding callbacks before completing a CLI run', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'codex-sender-project-'))
    const runner = new CodexCliRunner({
      command: process.execPath,
      commandPrefixArgs: ['-e', fakeCodexScript, '--'],
    })
    let callbackCompleted = false

    await runner.run({
      cwd,
      text: 'hello codex',
      onThreadStarted: async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        callbackCompleted = true
      },
    })

    expect(callbackCompleted).toBe(true)
  })

  it('queues a CLI send and persists the new thread binding', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const cwd = await mkdtemp(path.join(tmpdir(), 'codex-sender-project-'))
    const stateStore = new StateStore({ dataDirectory })
    const cliRunner = new CodexCliRunner({
      command: process.execPath,
      commandPrefixArgs: ['-e', fakeCodexScript, '--'],
    })
    const server = new BridgeServer({ stateStore, cliRunner, port: 0 })
    servers.push(server)
    const port = await server.start()
    const state = await stateStore.load()

    const response = await fetch(`http://127.0.0.1:${port}/api/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-codex-sender-token': state.token,
      },
      body: JSON.stringify({ cwd, text: 'hello codex' }),
    })
    const queued = await response.json() as { jobId: string }
    expect(response.status).toBe(202)

    let job: { status: string, threadId?: string } | undefined
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await fetch(`http://127.0.0.1:${port}/api/jobs/${queued.jobId}`, {
        headers: { 'x-codex-sender-token': state.token },
      })
      job = await result.json() as { status: string, threadId?: string }
      if (job.status === 'completed')
        break
      await new Promise(resolve => setTimeout(resolve, 20))
    }

    expect(job).toMatchObject({ status: 'completed', threadId: '019f-test-thread' })
    expect(await stateStore.getBinding(cwd)).toMatchObject({ activeThreadId: '019f-test-thread' })
  })

  it('rejects requests without the local access token', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const server = new BridgeServer({ stateStore: new StateStore({ dataDirectory }), port: 0 })
    servers.push(server)
    const port = await server.start()
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    expect(response.status).toBe(401)
  })
})
