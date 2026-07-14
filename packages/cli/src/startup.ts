import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

export async function registerStartup(cliEntryPath: string): Promise<string | undefined> {
  if (process.platform !== 'win32' || !process.env.APPDATA)
    return undefined
  const startupDirectory = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  const startupPath = path.join(startupDirectory, 'codex-sender-bridge.cmd')
  await mkdir(startupDirectory, { recursive: true })
  await writeFile(startupPath, `@echo off\r\nstart "" /min "${process.execPath}" "${cliEntryPath}" serve\r\n`, 'utf8')
  return startupPath
}

export async function removeStartup(): Promise<void> {
  if (process.platform !== 'win32' || !process.env.APPDATA)
    return
  const startupPath = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'codex-sender-bridge.cmd')
  await rm(startupPath, { force: true })
}

export function startBridgeDetached(cliEntryPath: string): void {
  const child = spawn(process.execPath, [cliEntryPath, 'serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}
