import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { createInterface } from 'node:readline'

export interface CodexCliRunnerOptions {
  command?: string
  commandPrefixArgs?: readonly string[]
  sandbox?: 'danger-full-access' | 'read-only' | 'workspace-write'
}

export interface CodexRunRequest {
  cwd: string
  text: string
  threadId?: string
  onThreadStarted?: (threadId: string) => void | Promise<void>
}

export interface CodexRunResult {
  threadId: string
}

export class CodexCliRunner {
  private readonly command: string
  private readonly commandPrefixArgs: readonly string[]
  private readonly sandbox: 'danger-full-access' | 'read-only' | 'workspace-write'

  constructor(options: CodexCliRunnerOptions = {}) {
    this.command = options.command ?? 'codex'
    this.commandPrefixArgs = options.commandPrefixArgs ?? []
    this.sandbox = options.sandbox ?? 'read-only'
  }

  async run(request: CodexRunRequest): Promise<CodexRunResult> {
    const codexArgs = request.threadId
      ? ['exec', 'resume', '--json', request.threadId, '-']
      : ['exec', '--json', '--sandbox', this.sandbox, '-C', request.cwd, '-']
    const invocation = resolveSpawnInvocation(this.command, [...this.commandPrefixArgs, ...codexArgs])
    const options: SpawnOptionsWithoutStdio = {
      cwd: request.cwd,
      env: process.env,
      windowsHide: true,
      stdio: 'pipe',
    }
    const child = spawn(invocation.command, invocation.args, options)
    const lines = createInterface({ input: child.stdout })
    let threadId = request.threadId
    let threadStartedTask = Promise.resolve()
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_192)
    })
    lines.on('line', (line) => {
      try {
        const event = JSON.parse(line) as { type?: string, thread_id?: string }
        if (event.type === 'thread.started' && event.thread_id) {
          const startedThreadId = event.thread_id
          threadId = startedThreadId
          threadStartedTask = threadStartedTask.then(async () => request.onThreadStarted?.(startedThreadId))
        }
      }
      catch {
        // Codex may print non-JSON diagnostics; stderr remains the error source.
      }
    })

    child.stdin.end(request.text)
    const exitCode = await waitForExit(child)
    lines.close()

    if (exitCode !== 0)
      throw new Error(stderr.trim() || `codex exec 退出，状态码 ${exitCode}`)
    await threadStartedTask
    if (!threadId)
      throw new Error('codex exec 未返回 thread.started 事件')

    return { threadId }
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve(code))
  })
}

function resolveSpawnInvocation(command: string, args: string[]): { command: string, args: string[] } {
  if (process.platform === 'win32' && command === 'codex') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'codex.cmd', ...args],
    }
  }
  return { command, args }
}
