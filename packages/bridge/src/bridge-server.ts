import type { ThreadSourceKind } from '@codex-sender/app-server-client'
import type { CodexSenderState } from '@codex-sender/core'
import type { Server } from 'node:http'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import path from 'node:path'
import { AppServerClient } from '@codex-sender/app-server-client'
import { CodexCliRunner } from './codex-cli-runner.js'
import { StateStore } from './state-store.js'

const visibleThreadSources: ThreadSourceKind[] = ['cli', 'vscode', 'exec', 'appServer', 'unknown']
const jobRetentionMs = 10 * 60 * 1000

export type BridgeJobStatus = 'completed' | 'failed' | 'queued' | 'running'

export interface BridgeJob {
  id: string
  cwd: string
  status: BridgeJobStatus
  threadId?: string
  error?: string
  createdAt: string
  completedAt?: string
}

export interface BridgeServerOptions {
  stateStore?: StateStore
  cliRunner?: CodexCliRunner
  appServerClient?: AppServerClient
  version?: string
  port?: number
}

export class BridgeServer {
  private readonly appServer: AppServerClient
  private readonly cliRunner: CodexCliRunner
  private readonly jobs = new Map<string, BridgeJob>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly stateStore: StateStore
  private readonly version: string
  private server?: Server
  private state?: CodexSenderState
  private nextJobId = 1
  private requestedPort?: number

  constructor(options: BridgeServerOptions = {}) {
    this.stateStore = options.stateStore ?? new StateStore()
    this.cliRunner = options.cliRunner ?? new CodexCliRunner()
    this.appServer = options.appServerClient ?? new AppServerClient()
    this.version = options.version ?? '0.0.0'
    this.requestedPort = options.port
  }

  async start(): Promise<number> {
    if (this.server)
      throw new Error('Bridge 已经启动')

    this.state = await this.stateStore.load()
    const server = createServer((request, response) => void this.handleRequest(request, response))
    this.server = server

    const port = this.requestedPort ?? this.state.port
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })

    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Bridge 未能获取监听端口')
    return address.port
  }

  async stop(): Promise<void> {
    this.appServer.stop()
    const server = this.server
    this.server = undefined
    if (!server)
      return
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }

  private async handleRequest(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    try {
      this.applyCors(request, response)
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end()
        return
      }
      if (!this.state)
        throw new HttpError(503, 'Bridge 尚未完成初始化')
      if (request.headers['x-codex-sender-token'] !== this.state.token)
        throw new HttpError(401, '无效的 bridge 访问令牌')

      const url = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (request.method === 'GET' && url.pathname === '/health') {
        this.json(response, 200, { ok: true, version: this.version })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/threads') {
        await this.handleListThreads(url, response)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/send') {
        const body = await readJsonBody(request) as { cwd?: unknown, text?: unknown }
        const cwd = requireAbsolutePath(body.cwd)
        const text = requireText(body.text)
        const job = this.enqueue(cwd, text)
        this.json(response, 202, { jobId: job.id, status: job.status })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/bind') {
        const body = await readJsonBody(request) as { cwd?: unknown, threadId?: unknown, title?: unknown }
        const cwd = requireAbsolutePath(body.cwd)
        if (typeof body.threadId !== 'string' || !body.threadId)
          throw new HttpError(400, 'threadId 无效')
        await this.stateStore.setBinding(cwd, {
          activeThreadId: body.threadId,
          title: typeof body.title === 'string' ? body.title : body.threadId,
          updatedAt: new Date().toISOString(),
        })
        this.json(response, 200, { ok: true })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/unbind') {
        const body = await readJsonBody(request) as { cwd?: unknown }
        await this.stateStore.removeBinding(requireAbsolutePath(body.cwd))
        this.json(response, 200, { ok: true })
        return
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const job = this.jobs.get(decodeURIComponent(url.pathname.slice('/api/jobs/'.length)))
        if (!job)
          throw new HttpError(404, '发送任务不存在')
        this.json(response, 200, job)
        return
      }

      throw new HttpError(404, '接口不存在')
    }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      this.json(response, status, { error: message })
    }
  }

  private async handleListThreads(url: URL, response: import('node:http').ServerResponse): Promise<void> {
    await this.appServer.initialize({
      name: 'codex_sender',
      title: 'Codex Sender',
      version: this.version,
    })
    const cwd = url.searchParams.get('cwd')
    const result = await this.appServer.listThreads({
      cwd: cwd || undefined,
      cursor: url.searchParams.get('cursor'),
      limit: 50,
      searchTerm: url.searchParams.get('search'),
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: visibleThreadSources,
    })
    this.json(response, 200, result)
  }

  private enqueue(cwd: string, text: string): BridgeJob {
    const id = `${Date.now().toString(36)}-${this.nextJobId++}`
    const job: BridgeJob = {
      id,
      cwd,
      status: 'queued',
      createdAt: new Date().toISOString(),
    }
    this.jobs.set(id, job)
    const key = path.normalize(cwd).toLowerCase()
    const previous = this.queues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(() => this.runJob(job, text))
    const queued = current.finally(() => {
      if (this.queues.get(key) === queued)
        this.queues.delete(key)
    })
    this.queues.set(key, queued)
    return job
  }

  private async runJob(job: BridgeJob, text: string): Promise<void> {
    job.status = 'running'

    try {
      const binding = await this.stateStore.getBinding(job.cwd)
      const result = await this.cliRunner.run({
        cwd: job.cwd,
        text,
        threadId: binding?.activeThreadId,
        onThreadStarted: async (threadId) => {
          job.threadId = threadId
          if (!binding) {
            await this.stateStore.setBinding(job.cwd, {
              activeThreadId: threadId,
              title: text.trim().split(/\r?\n/, 1)[0].slice(0, 80) || 'Codex Sender 任务',
              updatedAt: new Date().toISOString(),
            })
          }
        },
      })
      job.threadId = result.threadId
      job.status = 'completed'
    }
    catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
    }
    finally {
      job.completedAt = new Date().toISOString()
      const cleanup = setTimeout(() => this.jobs.delete(job.id), jobRetentionMs)
      cleanup.unref()
    }
  }

  private applyCors(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): void {
    const origin = request.headers.origin
    if (origin && origin !== 'null' && !origin.startsWith('file://') && !origin.startsWith('vscode-file://'))
      throw new HttpError(403, '不允许的请求来源')
    response.setHeader('access-control-allow-origin', origin ?? '*')
    response.setHeader('access-control-allow-headers', 'content-type,x-codex-sender-token')
    response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  }

  private json(response: import('node:http').ServerResponse, status: number, body: unknown): void {
    if (response.headersSent)
      return
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function readJsonBody(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_048_576)
      throw new HttpError(413, '请求体过大')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  catch {
    throw new HttpError(400, '请求体不是有效 JSON')
  }
}

function requireAbsolutePath(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value))
    throw new HttpError(400, 'cwd 必须是绝对路径')
  return path.normalize(value)
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new HttpError(400, '发送内容不能为空')
  if (value.length > 500_000)
    throw new HttpError(413, '发送内容过长')
  return value
}
