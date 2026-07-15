import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { getDefaultDataDirectory, initializeDefaultDataDirectory, Logger } from '../src/index.js'

describe('default data directory', () => {
  it('uses .codex-sender in the user home directory on every platform', () => {
    const homeDirectory = path.join(tmpdir(), 'codex-sender-home')
    expect(getDefaultDataDirectory(homeDirectory)).toBe(path.join(homeDirectory, '.codex-sender'))
  })

  it('places logs below the selected data directory', () => {
    const dataDirectory = path.join(tmpdir(), 'codex-sender-home', '.codex-sender')
    expect(new Logger({ dataDirectory }).logPath).toBe(path.join(dataDirectory, 'logs', 'codex-sender.log'))
  })
})

describe('legacy data directory migration', () => {
  it('moves state, installation data, backups, and logs into the new directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-sender-migration-'))
    const legacyDataDirectory = path.join(root, 'local-app-data', 'codex-sender')
    const dataDirectory = path.join(root, 'home', '.codex-sender')
    await writeFixture(legacyDataDirectory)

    await expect(initializeDefaultDataDirectory({
      dataDirectory,
      legacyDataDirectory,
      platform: 'win32',
    })).resolves.toBe(dataDirectory)

    await expect(readFile(path.join(dataDirectory, 'state.json'), 'utf8')).resolves.toBe('state')
    await expect(readFile(path.join(dataDirectory, 'installation.json'), 'utf8')).resolves.toBe('installation')
    await expect(readFile(path.join(dataDirectory, 'backups', 'fixture', 'workbench.html'), 'utf8')).resolves.toBe('workbench')
    await expect(readFile(path.join(dataDirectory, 'logs', 'codex-sender.log'), 'utf8')).resolves.toBe('log')
    await expect(stat(legacyDataDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('copies and verifies data before switching directories across volumes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-sender-cross-volume-'))
    const legacyDataDirectory = path.join(root, 'legacy')
    const dataDirectory = path.join(root, 'home', '.codex-sender')
    const crossDeviceError = Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
    const renameLegacyDirectory = vi.fn(async () => Promise.reject(crossDeviceError))
    await writeFixture(legacyDataDirectory)

    await initializeDefaultDataDirectory({
      dataDirectory,
      legacyDataDirectory,
      platform: 'win32',
      renameLegacyDirectory,
    })

    expect(renameLegacyDirectory).toHaveBeenCalledWith(legacyDataDirectory, dataDirectory)
    await expect(readFile(path.join(dataDirectory, 'logs', 'codex-sender.log'), 'utf8')).resolves.toBe('log')
    await expect(stat(legacyDataDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not overwrite or merge an existing new directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-sender-existing-target-'))
    const legacyDataDirectory = path.join(root, 'legacy')
    const dataDirectory = path.join(root, 'home', '.codex-sender')
    await writeFixture(legacyDataDirectory)
    await mkdir(dataDirectory, { recursive: true })
    await writeFile(path.join(dataDirectory, 'state.json'), 'new-state')

    await initializeDefaultDataDirectory({ dataDirectory, legacyDataDirectory, platform: 'win32' })

    await expect(readFile(path.join(dataDirectory, 'state.json'), 'utf8')).resolves.toBe('new-state')
    await expect(readFile(path.join(legacyDataDirectory, 'state.json'), 'utf8')).resolves.toBe('state')
    await expect(stat(path.join(dataDirectory, 'logs'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the old directory and leaves the target absent when migration fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-sender-failed-migration-'))
    const legacyDataDirectory = path.join(root, 'legacy')
    const dataDirectory = path.join(root, 'home', '.codex-sender')
    const accessError = Object.assign(new Error('access denied'), { code: 'EACCES' })
    await writeFixture(legacyDataDirectory)

    await expect(initializeDefaultDataDirectory({
      dataDirectory,
      legacyDataDirectory,
      platform: 'win32',
      renameLegacyDirectory: async () => Promise.reject(accessError),
    })).rejects.toBe(accessError)

    await expect(readFile(path.join(legacyDataDirectory, 'state.json'), 'utf8')).resolves.toBe('state')
    await expect(stat(dataDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function writeFixture(dataDirectory: string): Promise<void> {
  await mkdir(path.join(dataDirectory, 'backups', 'fixture'), { recursive: true })
  await mkdir(path.join(dataDirectory, 'logs'), { recursive: true })
  await writeFile(path.join(dataDirectory, 'state.json'), 'state')
  await writeFile(path.join(dataDirectory, 'installation.json'), 'installation')
  await writeFile(path.join(dataDirectory, 'backups', 'fixture', 'workbench.html'), 'workbench')
  await writeFile(path.join(dataDirectory, 'logs', 'codex-sender.log'), 'log')
}
