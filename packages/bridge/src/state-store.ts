import type { CodexSenderSettings, CodexSenderState, DeliveryMode, WorkspaceThreadBinding } from '@codex-sender/core'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { normalizeWorkspacePath } from '@codex-sender/core'
import { getDefaultDataDirectory } from './data-directory.js'

export { getDefaultDataDirectory, getLegacyDataDirectory, initializeDefaultDataDirectory } from './data-directory.js'

export interface StateStoreOptions {
  dataDirectory?: string
  defaultPort?: number
}

export class StateStore {
  readonly dataDirectory: string
  readonly statePath: string
  private readonly defaultPort: number
  private saveTask = Promise.resolve()
  private state?: CodexSenderState

  constructor(options: StateStoreOptions = {}) {
    this.dataDirectory = options.dataDirectory ?? getDefaultDataDirectory()
    this.statePath = path.join(this.dataDirectory, 'state.json')
    this.defaultPort = options.defaultPort ?? 47_321
    if (!isValidPort(this.defaultPort))
      throw new Error('Bridge 默认端口无效')
  }

  async load(): Promise<CodexSenderState> {
    if (this.state)
      return this.state

    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8')) as { version?: number }
      this.state = validateState(parsed)
      if (parsed.version !== this.state.version)
        await this.save()
    }
    catch (error) {
      if (!isMissingFileError(error))
        throw error
      this.state = createDefaultState(this.defaultPort)
      await this.save()
    }

    return this.state
  }

  async getBinding(cwd: string): Promise<WorkspaceThreadBinding | undefined> {
    return (await this.load()).workspaces[normalizeWorkspacePath(cwd)]
  }

  async getSettings(): Promise<CodexSenderSettings> {
    return (await this.load()).settings
  }

  async setBinding(cwd: string, binding: WorkspaceThreadBinding): Promise<void> {
    const state = await this.load()
    state.workspaces[normalizeWorkspacePath(cwd)] = binding
    await this.save()
  }

  async removeBinding(cwd: string): Promise<void> {
    const state = await this.load()
    delete state.workspaces[normalizeWorkspacePath(cwd)]
    await this.save()
  }

  async setDeliveryMode(deliveryMode: DeliveryMode): Promise<void> {
    const state = await this.load()
    state.settings.deliveryMode = deliveryMode
    await this.save()
  }

  async setPort(port: number): Promise<void> {
    if (!isValidPort(port))
      throw new Error('Bridge 端口无效')
    const state = await this.load()
    state.port = port
    await this.save()
  }

  async save(): Promise<void> {
    if (!this.state)
      throw new Error('StateStore 尚未加载')

    const serializedState = `${JSON.stringify(this.state, null, 2)}\n`
    this.saveTask = this.saveTask.catch(() => {}).then(async () => {
      await mkdir(this.dataDirectory, { recursive: true })
      const temporaryPath = `${this.statePath}.${process.pid}.tmp`
      await writeFile(temporaryPath, serializedState, 'utf8')
      await rename(temporaryPath, this.statePath)
    })
    await this.saveTask
  }
}

function createDefaultState(port: number): CodexSenderState {
  return {
    version: 2,
    port,
    token: randomBytes(32).toString('hex'),
    settings: { deliveryMode: 'copy' },
    workspaces: {},
  }
}

function validateState(value: unknown): CodexSenderState {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('codex-sender state.json 格式无效')

  const state = value as {
    version?: number
    port?: number
    token?: string
    settings?: Partial<CodexSenderSettings>
    workspaces?: Record<string, WorkspaceThreadBinding>
  }
  if ((state.version !== 1 && state.version !== 2)
    || !isValidPort(state.port ?? 0)
    || typeof state.token !== 'string'
    || !/^[a-f\d]{64}$/i.test(state.token)
    || !state.workspaces
    || typeof state.workspaces !== 'object'
    || Array.isArray(state.workspaces)) {
    throw new Error('codex-sender state.json 格式无效')
  }

  const deliveryMode = state.version === 2 ? state.settings?.deliveryMode : 'copy'
  if (deliveryMode !== 'copy' && deliveryMode !== 'paste' && deliveryMode !== 'paste-and-send')
    throw new Error('codex-sender state.json 发送方式无效')

  return {
    version: 2,
    port: state.port!,
    token: state.token,
    settings: { deliveryMode },
    workspaces: state.workspaces,
  }
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
