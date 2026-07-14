import type { InitializeResponse, ThreadListParams, ThreadListResponse } from '@codex-sender/app-server-client'
import type { CodexAppSystem } from '../src/index.js'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppServerClient } from '@codex-sender/app-server-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeServer, CodexAppLauncher, createNewTaskUrl, createThreadUrl, Logger, StateStore } from '../src/index.js'

const servers: BridgeServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
})

function createFakeSystem(): CodexAppSystem {
  return {
    copyFocusedCursorPrompt: vi.fn(async () => ''),
    copyAndOpen: vi.fn(async () => {}),
    pasteIntoComposer: vi.fn(async () => {}),
    readClipboardText: vi.fn(async () => ''),
  }
}

class StubAppServerClient extends AppServerClient {
  override async initialize(): Promise<InitializeResponse> {
    return { userAgent: 'test', codexHome: 'test', platformFamily: 'windows', platformOs: 'windows' }
  }

  override async listThreads(_params: ThreadListParams): Promise<ThreadListResponse> {
    return {
      data: [{
        id: '019f-test-thread',
        sessionId: 'session',
        preview: '测试任务',
        ephemeral: false,
        createdAt: 1,
        updatedAt: 2,
        cwd: 'D:\\work\\demo',
        source: 'appServer',
        status: 'idle',
        name: '测试任务',
      }],
      nextCursor: null,
      backwardsCursor: null,
    }
  }
}

describe('codex app launcher', () => {
  it('prefills a new task through the official deep link', async () => {
    const system = createFakeSystem()
    const launcher = new CodexAppLauncher({ platform: 'win32', system })
    const result = await launcher.deliver({ cwd: 'D:\\work\\demo', text: '你好 Codex', mode: 'copy' })

    expect(result).toMatchObject({ prefilled: true, pasted: false, copied: true })
    const url = createNewTaskUrl('D:\\work\\demo', '你好 Codex')
    expect(url).toContain('prompt=%E4%BD%A0%E5%A5%BD%20Codex')
    expect(url).toContain('path=D%3A%5Cwork%5Cdemo')
    expect(system.copyAndOpen).toHaveBeenCalledWith(url, '你好 Codex')
    expect(system.pasteIntoComposer).not.toHaveBeenCalled()
  })

  it('keeps oversized new-task prompts in the clipboard instead of creating an unsafe URL', async () => {
    const system = createFakeSystem()
    const launcher = new CodexAppLauncher({ platform: 'win32', system })
    const text = 'a'.repeat(20_000)
    const result = await launcher.deliver({ cwd: 'D:\\work\\demo', text, mode: 'copy' })

    expect(result).toMatchObject({ prefilled: false, pasted: false, mode: 'copy' })
    expect(system.copyAndOpen).toHaveBeenCalledWith(createNewTaskUrl('D:\\work\\demo'), text)
  })

  it('opens an existing task and falls back to the clipboard if guarded paste fails', async () => {
    const system = createFakeSystem()
    vi.mocked(system.pasteIntoComposer).mockRejectedValueOnce(new Error('输入框已有草稿'))
    const launcher = new CodexAppLauncher({ platform: 'win32', system })
    const result = await launcher.deliver({
      cwd: 'D:\\work\\demo',
      text: '继续处理',
      threadId: '019f-test-thread',
      mode: 'paste',
    })

    expect(result).toMatchObject({ mode: 'copy', requestedMode: 'paste', pasted: false })
    expect(result.warning).toContain('输入框已有草稿')
    expect(system.copyAndOpen).toHaveBeenCalledWith(createThreadUrl('019f-test-thread'), '继续处理')
  })
})

describe('diagnostic logger', () => {
  it('redacts tokens and summarizes prompt-like text', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-logger-'))
    const logger = new Logger({ dataDirectory })
    await logger.log('info', 'copy_test', {
      token: 'super-secret-token',
      clipboardText: '分析 @docker/Dockerfile.app',
      richNodes: [{ attributes: { 'data-path': 'docker/Dockerfile.app' } }],
    })

    const log = await readFile(logger.logPath, 'utf8')
    expect(log).toContain('copy_test')
    expect(log).toContain('"containsAt":true')
    expect(log).toContain('docker/Dockerfile.app')
    expect(log).not.toContain('super-secret-token')
    expect(log).not.toContain('分析 @docker/Dockerfile.app')
  })
})

describe('bridge server', () => {
  it('migrates existing version 1 state to the safe copy mode', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-state-'))
    const statePath = path.join(dataDirectory, 'state.json')
    await mkdir(dataDirectory, { recursive: true })
    await writeFile(statePath, JSON.stringify({
      version: 1,
      port: 47_321,
      token: 'a'.repeat(64),
      workspaces: {},
    }))

    const state = await new StateStore({ dataDirectory }).load()

    expect(state).toMatchObject({ version: 2, settings: { deliveryMode: 'copy' } })
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ version: 2 })
  })

  it('hands a prompt to the bound Codex App task immediately', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const cwd = await mkdtemp(path.join(tmpdir(), 'codex-sender-project-'))
    const stateStore = new StateStore({ dataDirectory })
    const system = createFakeSystem()
    const appLauncher = new CodexAppLauncher({ platform: 'win32', system })
    const logger = new Logger({ dataDirectory })
    await stateStore.load()
    await stateStore.setBinding(cwd, { activeThreadId: '019f-test-thread', title: '测试任务' })
    const server = new BridgeServer({ stateStore, appLauncher, logger, port: 0 })
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
    const result = await response.json() as { threadId?: string, copied?: boolean }

    expect(response.status).toBe(200)
    expect(result).toMatchObject({ threadId: '019f-test-thread', copied: true })
    expect(system.copyAndOpen).toHaveBeenCalledWith(createThreadUrl('019f-test-thread'), 'hello codex')
    const log = await readFile(logger.logPath, 'utf8')
    expect(log).toContain('"event":"delivery_completed"')
    expect(log).toContain('"requestedMode":"copy"')
    expect(log).toContain('"pasted":false')
  })

  it('logs guarded paste failures without logging the prompt body', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const cwd = await mkdtemp(path.join(tmpdir(), 'codex-sender-project-'))
    const stateStore = new StateStore({ dataDirectory })
    const system = createFakeSystem()
    vi.mocked(system.pasteIntoComposer).mockRejectedValueOnce(new Error('未找到输入框'))
    const logger = new Logger({ dataDirectory })
    await stateStore.load()
    await stateStore.setBinding(cwd, { activeThreadId: '019f-test-thread', title: '测试任务' })
    await stateStore.setDeliveryMode('paste')
    const server = new BridgeServer({
      stateStore,
      appLauncher: new CodexAppLauncher({ platform: 'win32', system }),
      logger,
      port: 0,
    })
    servers.push(server)
    const port = await server.start()
    const state = await stateStore.load()

    const response = await fetch(`http://127.0.0.1:${port}/api/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-codex-sender-token': state.token,
      },
      body: JSON.stringify({ cwd, text: '不要写入日志的提示词' }),
    })

    expect(response.status).toBe(200)
    const log = await readFile(logger.logPath, 'utf8')
    expect(log).toContain('"event":"delivery_completed"')
    expect(log).toContain('"requestedMode":"paste"')
    expect(log).toContain('"mode":"copy"')
    expect(log).toContain('自动粘贴未完成：未找到输入框')
    expect(log).not.toContain('不要写入日志的提示词')
  })

  it('hands Cursor native clipboard text to Codex without returning it to the renderer', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const cwd = await mkdtemp(path.join(tmpdir(), 'codex-sender-project-'))
    const stateStore = new StateStore({ dataDirectory })
    const system = createFakeSystem()
    vi.mocked(system.readClipboardText).mockResolvedValue('分析 @docker/Dockerfile.app @admin.ts (26-40)')
    const appLauncher = new CodexAppLauncher({ platform: 'win32', system })
    const server = new BridgeServer({ stateStore, appLauncher, port: 0 })
    servers.push(server)
    const port = await server.start()
    const state = await stateStore.load()

    const response = await fetch(`http://127.0.0.1:${port}/api/send-clipboard`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-codex-sender-token': state.token,
      },
      body: JSON.stringify({ cwd, fallbackText: '分析 Dockerfile.app admin.ts', expectsFileReferences: true }),
    })

    expect(response.status).toBe(200)
    expect(system.copyAndOpen).toHaveBeenCalledWith(
      createNewTaskUrl(cwd, '分析 @docker/Dockerfile.app @admin.ts (26-40)'),
      '分析 @docker/Dockerfile.app @admin.ts (26-40)',
    )
  })

  it('returns a trusted native Cursor copy when it contains file references', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const stateStore = new StateStore({ dataDirectory })
    const system = createFakeSystem()
    vi.mocked(system.copyFocusedCursorPrompt).mockResolvedValue('分析 @docker/Dockerfile.app @admin.ts (26-40)')
    const server = new BridgeServer({
      stateStore,
      appLauncher: new CodexAppLauncher({ platform: 'win32', system }),
      port: 0,
    })
    servers.push(server)
    const port = await server.start()
    const state = await stateStore.load()

    const response = await fetch(`http://127.0.0.1:${port}/api/copy-cursor-prompt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-codex-sender-token': state.token,
      },
      body: JSON.stringify({ fallbackText: '分析 Dockerfile.app admin.ts', expectsFileReferences: true }),
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toEqual({ text: '分析 @docker/Dockerfile.app @admin.ts (26-40)' })
  })

  it('rejects malformed rich clipboard text instead of sending bare file names', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const cwd = await mkdtemp(path.join(tmpdir(), 'codex-sender-project-'))
    const stateStore = new StateStore({ dataDirectory })
    const system = createFakeSystem()
    vi.mocked(system.readClipboardText).mockResolvedValue('分析 Dockerfile.app admin.ts')
    const server = new BridgeServer({
      stateStore,
      appLauncher: new CodexAppLauncher({ platform: 'win32', system }),
      port: 0,
    })
    servers.push(server)
    const port = await server.start()
    const state = await stateStore.load()

    const response = await fetch(`http://127.0.0.1:${port}/api/send-clipboard`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-codex-sender-token': state.token,
      },
      body: JSON.stringify({ cwd, fallbackText: '分析 Dockerfile.app admin.ts', expectsFileReferences: true }),
    })

    expect(response.status).toBe(422)
    expect(system.copyAndOpen).not.toHaveBeenCalled()
  })

  it('persists the guarded paste setting', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const stateStore = new StateStore({ dataDirectory })
    const server = new BridgeServer({ stateStore, port: 0 })
    servers.push(server)
    const port = await server.start()
    const state = await stateStore.load()

    const response = await fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-codex-sender-token': state.token,
      },
      body: JSON.stringify({ deliveryMode: 'paste' }),
    })

    expect(response.status).toBe(200)
    expect(await stateStore.getSettings()).toEqual({ deliveryMode: 'paste' })
  })

  it('returns thread data with the current binding and delivery setting', async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-bridge-'))
    const stateStore = new StateStore({ dataDirectory })
    const cwd = 'D:\\work\\demo'
    await stateStore.load()
    await stateStore.setBinding(cwd, { activeThreadId: '019f-test-thread', title: '测试任务' })
    await stateStore.setDeliveryMode('paste')
    const server = new BridgeServer({ stateStore, appServerClient: new StubAppServerClient(), port: 0 })
    servers.push(server)
    const port = await server.start()
    const state = await stateStore.load()

    const response = await fetch(`http://127.0.0.1:${port}/api/threads?cwd=${encodeURIComponent(cwd)}`, {
      headers: { 'x-codex-sender-token': state.token },
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result).toMatchObject({
      data: [{ id: '019f-test-thread' }],
      binding: { activeThreadId: '019f-test-thread', title: '测试任务' },
      settings: { deliveryMode: 'paste' },
    })
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
