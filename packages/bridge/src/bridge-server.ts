import type { ThreadSourceKind } from '@codex-sender/app-server-client'
import type { CodexSenderState, DeliveryMode } from '@codex-sender/core'
import type { Server } from 'node:http'
import type { LogLevel } from './logger.js'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import path from 'node:path'
import { AppServerClient } from '@codex-sender/app-server-client'
import { CodexAppLauncher } from './codex-app-launcher.js'
import { Logger, summarizeText } from './logger.js'
import { StateStore } from './state-store.js'

const visibleThreadSources: ThreadSourceKind[] = ['cli', 'vscode', 'exec', 'appServer', 'unknown']

export interface BridgeServerOptions {
  stateStore?: StateStore
  appLauncher?: CodexAppLauncher
  appServerClient?: AppServerClient
  logger?: Logger
  version?: string
  port?: number
}

export class BridgeServer {
  private readonly appServer: AppServerClient
  private readonly appLauncher: CodexAppLauncher
  private readonly logger: Logger
  private readonly stateStore: StateStore
  private readonly version: string
  private server?: Server
  private state?: CodexSenderState
  private requestedPort?: number

  constructor(options: BridgeServerOptions = {}) {
    this.stateStore = options.stateStore ?? new StateStore()
    this.appLauncher = options.appLauncher ?? new CodexAppLauncher()
    this.logger = options.logger ?? new Logger({ dataDirectory: this.stateStore.dataDirectory })
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
    await this.logger.log('info', 'bridge_started', { port: address.port, version: this.version, stateVersion: this.state.version })
    return address.port
  }

  async stop(): Promise<void> {
    this.appServer.stop()
    const server = this.server
    this.server = undefined
    if (!server)
      return
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await this.logger.log('info', 'bridge_stopped')
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
      if (request.method === 'POST' && url.pathname === '/api/log') {
        const body = await readJsonBody(request) as { level?: unknown, event?: unknown, data?: unknown }
        if (typeof body.event !== 'string' || !body.event.trim() || body.event.length > 120)
          throw new HttpError(400, '日志事件名称无效')
        await this.logger.log(requireLogLevel(body.level), body.event, body.data)
        this.json(response, 200, { ok: true })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/send') {
        const body = await readJsonBody(request) as { cwd?: unknown, text?: unknown, mode?: unknown }
        const cwd = requireAbsolutePath(body.cwd)
        const text = requireText(body.text)
        const settings = await this.stateStore.getSettings()
        const mode = body.mode === undefined ? settings.deliveryMode : requireDeliveryMode(body.mode)
        const binding = await this.stateStore.getBinding(cwd)
        await this.logger.log('info', 'send_requested', {
          cwd,
          mode,
          hasBinding: Boolean(binding),
          promptText: text,
        })
        const result = await this.appLauncher.deliver({
          cwd,
          text,
          mode,
          threadId: binding?.activeThreadId,
        })
        await this.logDeliveryResult(result)
        this.json(response, 200, result)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/copy-cursor-prompt') {
        const body = await readJsonBody(request) as { fallbackText?: unknown, expectsFileReferences?: unknown }
        const fallbackText = typeof body.fallbackText === 'string' ? body.fallbackText : ''
        const expectsFileReferences = body.expectsFileReferences === true
        let text = await this.appLauncher.copyFocusedCursorPrompt()
        await this.logger.log('info', 'native_cursor_copy_completed', {
          expectsFileReferences,
          clipboardText: text,
          fallbackText,
        })
        if (!text.trim())
          text = fallbackText
        if (expectsFileReferences && !text.includes('@')) {
          await this.logger.log('warn', 'native_cursor_copy_rejected', {
            clipboard: summarizeText(text),
            fallback: summarizeText(fallbackText),
          })
          throw new HttpError(422, 'Cursor 原生复制结果缺少 @文件路径，已停止交接')
        }
        text = requireText(text)
        this.json(response, 200, { text })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/send-clipboard') {
        const body = await readJsonBody(request) as {
          cwd?: unknown
          fallbackText?: unknown
          expectsFileReferences?: unknown
        }
        const cwd = requireAbsolutePath(body.cwd)
        const fallbackText = typeof body.fallbackText === 'string' ? body.fallbackText : ''
        const expectsFileReferences = body.expectsFileReferences === true
        let text = await this.appLauncher.readClipboardText()
        await this.logger.log('info', 'clipboard_read', {
          cwd,
          expectsFileReferences,
          clipboardText: text,
          fallbackText,
        })
        if (!text.trim())
          text = fallbackText
        if (expectsFileReferences && !text.includes('@')) {
          await this.logger.log('warn', 'clipboard_rich_text_rejected', {
            cwd,
            clipboard: summarizeText(text),
            fallback: summarizeText(fallbackText),
          })
          throw new HttpError(422, '未能从系统剪贴板读取 @文件路径，已停止交接')
        }
        text = requireText(text)
        const settings = await this.stateStore.getSettings()
        const binding = await this.stateStore.getBinding(cwd)
        const result = await this.appLauncher.deliver({
          cwd,
          text,
          mode: settings.deliveryMode,
          threadId: binding?.activeThreadId,
        })
        await this.logDeliveryResult(result)
        this.json(response, 200, result)
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/settings') {
        this.json(response, 200, await this.stateStore.getSettings())
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/settings') {
        const body = await readJsonBody(request) as { deliveryMode?: unknown }
        const deliveryMode = requireDeliveryMode(body.deliveryMode)
        await this.stateStore.setDeliveryMode(deliveryMode)
        await this.logger.log('info', 'delivery_mode_changed', { deliveryMode })
        this.json(response, 200, { deliveryMode })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/bind') {
        const body = await readJsonBody(request) as { cwd?: unknown, threadId?: unknown, title?: unknown }
        const cwd = requireAbsolutePath(body.cwd)
        const threadId = requireThreadId(body.threadId)
        const title = typeof body.title === 'string' && body.title.trim()
          ? body.title.trim().slice(0, 200)
          : threadId
        await this.stateStore.setBinding(cwd, {
          activeThreadId: threadId,
          title,
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
      throw new HttpError(404, '接口不存在')
    }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : String(error)
      await this.logger.log(status >= 500 ? 'error' : 'warn', 'http_request_failed', {
        method: request.method,
        path: request.url,
        status,
        error,
      })
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
    const binding = cwd ? await this.stateStore.getBinding(cwd) : undefined
    const settings = await this.stateStore.getSettings()
    this.json(response, 200, { ...result, binding, settings })
  }

  private applyCors(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): void {
    const origin = request.headers.origin
    if (origin && origin !== 'null' && !origin.startsWith('file://') && !origin.startsWith('vscode-file://'))
      throw new HttpError(403, '不允许的请求来源')
    response.setHeader('access-control-allow-origin', origin ?? '*')
    response.setHeader('access-control-allow-headers', 'content-type,x-codex-sender-token')
    response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  }

  private async logDeliveryResult(result: Awaited<ReturnType<CodexAppLauncher['deliver']>>): Promise<void> {
    await this.logger.log(result.warning ? 'warn' : 'info', 'delivery_completed', {
      requestedMode: result.requestedMode,
      mode: result.mode,
      threadId: result.threadId,
      prefilled: result.prefilled,
      pasted: result.pasted,
      submitted: result.submitted,
      warning: result.warning,
    })
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

function requireDeliveryMode(value: unknown): DeliveryMode {
  if (value !== 'copy' && value !== 'paste' && value !== 'paste-and-send')
    throw new HttpError(400, 'deliveryMode 必须是 copy、paste 或 paste-and-send')
  return value
}

function requireThreadId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w.-]{1,128}$/.test(value))
    throw new HttpError(400, 'threadId 格式无效')
  return value
}

function requireLogLevel(value: unknown): LogLevel {
  if (value === 'debug' || value === 'error' || value === 'info' || value === 'warn')
    return value
  return 'info'
}
