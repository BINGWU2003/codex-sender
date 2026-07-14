import type { CodexSenderState, WorkspaceThreadBinding } from '@codex-sender/core'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { normalizeWorkspacePath } from '@codex-sender/core'

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
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8')) as CodexSenderState
      this.state = validateState(parsed)
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

export function getDefaultDataDirectory(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA)
    return path.join(process.env.LOCALAPPDATA, 'codex-sender')
  return path.join(homedir(), '.codex-sender')
}

function createDefaultState(port: number): CodexSenderState {
  return {
    version: 1,
    port,
    token: randomBytes(32).toString('hex'),
    workspaces: {},
  }
}

function validateState(state: CodexSenderState): CodexSenderState {
  if (state.version !== 1
    || !isValidPort(state.port)
    || typeof state.token !== 'string'
    || !/^[a-f\d]{64}$/i.test(state.token)
    || !state.workspaces
    || typeof state.workspaces !== 'object'
    || Array.isArray(state.workspaces)) {
    throw new Error('codex-sender state.json 格式无效')
  }
  return state
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
