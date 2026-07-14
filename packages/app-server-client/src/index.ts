import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { Interface as ReadlineInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import process from 'node:process'
import { createInterface } from 'node:readline'

export type JsonRpcId = number | string
export interface JsonObject { [key: string]: JsonValue | undefined }
export type JsonValue = boolean | null | number | string | JsonObject | JsonValue[]

export interface ClientInfo extends JsonObject {
  name: string
  title?: string
  version: string
}

export interface InitializeCapabilities extends JsonObject {
  experimentalApi?: boolean
  optOutNotificationMethods?: string[]
}

export interface InitializeResponse extends JsonObject {
  userAgent: string
  codexHome: string
  platformFamily: string
  platformOs: string
}

export interface ThreadStartParams extends JsonObject {
  cwd?: string | null
  model?: string | null
}

export interface ThreadResumeParams extends JsonObject {
  threadId: string
  cwd?: string | null
}

export interface ThreadResponse extends JsonObject {
  thread: JsonObject & { id: string }
}

export interface TurnStartParams extends JsonObject {
  threadId: string
  input: Array<JsonObject & { type: 'text', text: string, text_elements: [] }>
  cwd?: string | null
}

export interface TurnStartResponse extends JsonObject {
  turn: JsonObject & { id: string }
}

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: JsonValue
}

export interface JsonRpcMessage {
  id?: JsonRpcId
  method?: string
  params?: JsonValue
  result?: JsonValue
  error?: JsonRpcErrorObject
}

export interface AppServerClientOptions {
  command?: string
  args?: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  requestTimeoutMs?: number
}

interface PendingRequest {
  resolve: (value: JsonValue | undefined) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function parseServerMessage(line: string): JsonRpcMessage {
  const parsed: unknown = JSON.parse(line)

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new TypeError('Codex App Server 返回了无效的 JSONL 消息')

  return parsed as JsonRpcMessage
}

export class AppServerClient extends EventEmitter {
  private readonly options: Required<Pick<AppServerClientOptions, 'args' | 'command' | 'requestTimeoutMs'>> & AppServerClientOptions
  private readonly pending = new Map<JsonRpcId, PendingRequest>()
  private child?: ChildProcessWithoutNullStreams
  private initializePromise?: Promise<InitializeResponse>
  private lines?: ReadlineInterface
  private nextId = 1

  constructor(options: AppServerClientOptions = {}) {
    super()
    this.options = {
      ...options,
      command: options.command ?? 'codex',
      args: options.args ?? ['app-server'],
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
    }
  }

  get running(): boolean {
    return Boolean(this.child && !this.child.killed)
  }

  get initialized(): boolean {
    return Boolean(this.initializePromise)
  }

  async start(): Promise<void> {
    if (this.child)
      return

    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: this.options.cwd,
      env: this.options.env,
      windowsHide: true,
      stdio: 'pipe',
    }
    const invocation = resolveSpawnInvocation(this.options.command, this.options.args)
    const child = spawn(invocation.command, invocation.args, spawnOptions)
    const lines = createInterface({ input: child.stdout })

    this.child = child
    this.lines = lines
    lines.on('line', line => this.handleLine(line))
    child.stderr.on('data', chunk => this.emit('stderr', chunk.toString()))
    child.on('exit', (code, signal) => this.handleExit(child, code, signal))

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  }

  async request<T extends JsonValue | undefined = JsonValue>(method: string, params?: JsonValue): Promise<T> {
    const child = this.requireChild()
    const id = this.nextId++

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex App Server 请求超时：${method}`))
      }, this.options.requestTimeoutMs)

      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timer,
      })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  async initialize(clientInfo: ClientInfo, capabilities?: InitializeCapabilities): Promise<InitializeResponse> {
    await this.start()

    if (!this.initializePromise) {
      this.initializePromise = this.request<InitializeResponse>('initialize', {
        clientInfo,
        capabilities: capabilities ?? null,
      }).then((response) => {
        this.notify('initialized')
        return response
      }).catch((error) => {
        this.initializePromise = undefined
        throw error
      })
    }

    return await this.initializePromise
  }

  async startThread(params: ThreadStartParams = {}): Promise<ThreadResponse> {
    this.requireInitialized()
    return await this.request<ThreadResponse>('thread/start', params)
  }

  async resumeThread(params: ThreadResumeParams): Promise<ThreadResponse> {
    this.requireInitialized()
    return await this.request<ThreadResponse>('thread/resume', params)
  }

  async startTextTurn(params: { threadId: string, text: string, cwd?: string }): Promise<TurnStartResponse> {
    this.requireInitialized()
    const request: TurnStartParams = {
      threadId: params.threadId,
      cwd: params.cwd,
      input: [{
        type: 'text',
        text: params.text,
        text_elements: [],
      }],
    }
    return await this.request<TurnStartResponse>('turn/start', request)
  }

  notify(method: string, params?: JsonValue): void {
    this.requireChild().stdin.write(`${JSON.stringify({ method, params })}\n`)
  }

  stop(): void {
    const child = this.child
    this.child = undefined
    this.initializePromise = undefined
    this.lines?.close()
    this.lines = undefined
    child?.kill()
    this.rejectPending(new Error('Codex App Server 客户端已停止'))
  }

  dispose(): void {
    this.stop()
  }

  private requireChild(): ChildProcessWithoutNullStreams {
    if (!this.child || this.child.killed)
      throw new Error('Codex App Server 尚未启动')

    return this.child
  }

  private requireInitialized(): void {
    if (!this.initializePromise)
      throw new Error('Codex App Server 尚未完成初始化握手')
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage

    try {
      message = parseServerMessage(line)
    }
    catch (error) {
      this.emit('protocolError', error, line)
      return
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!
      this.pending.delete(message.id)
      clearTimeout(pending.timer)

      if (message.error)
        pending.reject(new Error(`Codex App Server 错误 ${message.error.code}：${message.error.message}`))
      else
        pending.resolve(message.result)

      return
    }

    this.emit('notification', message)
  }

  private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child)
      return

    this.child = undefined
    this.initializePromise = undefined
    this.lines?.close()
    this.lines = undefined
    this.rejectPending(new Error(`Codex App Server 已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`))
    this.emit('exit', code, signal)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function resolveSpawnInvocation(command: string, args: readonly string[]): { command: string, args: string[] } {
  if (process.platform === 'win32' && command === 'codex') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'codex.cmd', ...args],
    }
  }

  return { command, args: [...args] }
}
