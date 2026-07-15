import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

export interface InitializeDefaultDataDirectoryOptions {
  dataDirectory?: string
  legacyDataDirectory?: string
  platform?: NodeJS.Platform
  renameLegacyDirectory?: (source: string, destination: string) => Promise<void>
}

export function getDefaultDataDirectory(homeDirectory = homedir()): string {
  return path.join(homeDirectory, '.codex-sender')
}

export function getLegacyDataDirectory(
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA,
): string | undefined {
  if (platform !== 'win32' || !localAppData)
    return undefined
  return path.join(localAppData, 'codex-sender')
}

export async function initializeDefaultDataDirectory(
  options: InitializeDefaultDataDirectoryOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform
  const dataDirectory = options.dataDirectory ?? getDefaultDataDirectory()
  const legacyDataDirectory = options.legacyDataDirectory ?? getLegacyDataDirectory(platform)

  if (platform !== 'win32'
    || !legacyDataDirectory
    || samePath(dataDirectory, legacyDataDirectory)
    || await pathExists(dataDirectory)
    || !await pathExists(legacyDataDirectory)) {
    return dataDirectory
  }

  await migrateDataDirectory(
    legacyDataDirectory,
    dataDirectory,
    options.renameLegacyDirectory ?? rename,
  )
  return dataDirectory
}

async function migrateDataDirectory(
  source: string,
  destination: string,
  renameLegacyDirectory: (source: string, destination: string) => Promise<void>,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true })
  try {
    await renameLegacyDirectory(source, destination)
    return
  }
  catch (error) {
    if (!isCrossDeviceError(error))
      throw error
  }

  const stagingDirectory = `${destination}.migrating-${process.pid}-${randomUUID()}`
  try {
    await cp(source, stagingDirectory, { recursive: true, errorOnExist: true, force: false })
    await verifyDirectoryCopy(source, stagingDirectory)
    await rename(stagingDirectory, destination)
    await rm(source, { recursive: true, force: true })
  }
  catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function verifyDirectoryCopy(source: string, destination: string): Promise<void> {
  const sourceEntries = await describeDirectory(source)
  const destinationEntries = await describeDirectory(destination)
  if (sourceEntries.length !== destinationEntries.length)
    throw new Error('Codex Sender 旧数据目录复制校验失败')

  for (let index = 0; index < sourceEntries.length; index++) {
    const sourceEntry = sourceEntries[index]
    const destinationEntry = destinationEntries[index]
    if (sourceEntry.relativePath !== destinationEntry.relativePath
      || sourceEntry.type !== destinationEntry.type
      || sourceEntry.size !== destinationEntry.size
      || sourceEntry.sha256 !== destinationEntry.sha256) {
      throw new Error('Codex Sender 旧数据目录复制校验失败')
    }
  }
}

interface DirectoryEntryDescription {
  relativePath: string
  sha256?: string
  size?: number
  type: 'directory' | 'file'
}

async function describeDirectory(root: string, current = root): Promise<DirectoryEntryDescription[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const descriptions: DirectoryEntryDescription[] = []
  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    const absolutePath = path.join(current, entry.name)
    const relativePath = path.relative(root, absolutePath)
    if (entry.isDirectory()) {
      descriptions.push({ relativePath, type: 'directory' })
      descriptions.push(...await describeDirectory(root, absolutePath))
      continue
    }
    if (!entry.isFile())
      throw new Error(`Codex Sender 数据目录包含不支持的文件类型：${relativePath}`)
    const fileStat = await stat(absolutePath)
    const contents = await readFile(absolutePath)
    descriptions.push({
      relativePath,
      sha256: createHash('sha256').update(contents).digest('hex'),
      size: fileStat.size,
      type: 'file',
    })
  }
  return descriptions
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  }
  catch (error) {
    if (isMissingFileError(error))
      return false
    throw error
  }
}

function isCrossDeviceError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EXDEV'
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function samePath(first: string, second: string): boolean {
  return path.resolve(first).toLowerCase() === path.resolve(second).toLowerCase()
}
