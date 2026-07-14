import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { getDefaultDataDirectory } from './state-store.js'

export type LogLevel = 'debug' | 'error' | 'info' | 'warn'

export interface LoggerOptions {
  dataDirectory?: string
  maxBytes?: number
  retainedFiles?: number
}

export class Logger {
  readonly logDirectory: string
  readonly logPath: string
  private readonly maxBytes: number
  private readonly retainedFiles: number
  private writeTask = Promise.resolve()

  constructor(options: LoggerOptions = {}) {
    this.logDirectory = path.join(options.dataDirectory ?? getDefaultDataDirectory(), 'logs')
    this.logPath = path.join(this.logDirectory, 'codex-sender.log')
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024
    this.retainedFiles = options.retainedFiles ?? 3
  }

  async log(level: LogLevel, event: string, data: unknown = {}): Promise<void> {
    const entry = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event: event.slice(0, 120),
      data: sanitizeLogValue(data),
    })}\n`
    const task = this.writeTask.catch(() => {}).then(async () => {
      await mkdir(this.logDirectory, { recursive: true })
      await this.rotateIfNeeded(Buffer.byteLength(entry))
      await appendFile(this.logPath, entry, 'utf8')
    })
    this.writeTask = task.catch(() => {})
    await task.catch(() => {})
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentBytes = 0
    try {
      currentBytes = (await stat(this.logPath)).size
    }
    catch (error) {
      if (!isMissingFileError(error))
        throw error
    }
    if (currentBytes + incomingBytes <= this.maxBytes)
      return

    await rm(`${this.logPath}.${this.retainedFiles}`, { force: true })
    for (let index = this.retainedFiles - 1; index >= 1; index--)
      await renameIfPresent(`${this.logPath}.${index}`, `${this.logPath}.${index + 1}`)
    await renameIfPresent(this.logPath, `${this.logPath}.1`)
  }
}

export function summarizeText(value: string): { containsAt: boolean, length: number, sha256: string } {
  return {
    length: value.length,
    containsAt: value.includes('@'),
    sha256: createHash('sha256').update(value).digest('hex').slice(0, 16),
  }
}

function sanitizeLogValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 6)
    return '[MAX_DEPTH]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number')
    return value
  if (typeof value === 'string') {
    if (/token|authorization|secret/i.test(key))
      return '[REDACTED]'
    if (/clipboard|content|fallback|html|prompt|selectedText|text$/i.test(key))
      return summarizeText(value)
    return value.length > 1_000 ? `${value.slice(0, 1_000)}…` : value
  }
  if (Array.isArray(value))
    return value.slice(0, 50).map(item => sanitizeLogValue(item, key, depth + 1))
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split(/\r?\n/).slice(0, 8).join('\n'),
    }
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeLogValue(entryValue, entryKey, depth + 1),
    ]))
  }
  return String(value)
}

async function renameIfPresent(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination)
  }
  catch (error) {
    if (!isMissingFileError(error))
      throw error
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
