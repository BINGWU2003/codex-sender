import type { InjectionConfig } from '@codex-sender/injector'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createInjectionScript } from '@codex-sender/injector'

const checksumKey = 'vs/code/electron-sandbox/workbench/workbench.html'
const injectionFileName = 'codex-sender.inject.js'
const injectionStart = '<!-- codex-sender:start -->'
const injectionEnd = '<!-- codex-sender:end -->'

export interface CursorInstallationPaths {
  appRoot: string
  productJsonPath: string
  workbenchHtmlPath: string
  injectionScriptPath: string
}

export interface InstallationManifest {
  formatVersion: 1
  cursorVersion: string
  installedAt: string
  paths: CursorInstallationPaths
  backupDirectory: string
  originalWorkbenchSha256: string
  patchedWorkbenchSha256: string
}

export interface CursorInstallerOptions {
  dataDirectory: string
  cursorPath?: string
  platform?: NodeJS.Platform
  skipRunningCheck?: boolean
}

export interface DoctorReport {
  ok: boolean
  cursorVersion?: string
  appRoot?: string
  htmlInjected: boolean
  injectionScriptPresent: boolean
  checksumMatches: boolean
  problems: string[]
}

export class CursorInstaller {
  readonly manifestPath: string
  private readonly options: CursorInstallerOptions

  constructor(options: CursorInstallerOptions) {
    this.options = options
    this.manifestPath = path.join(options.dataDirectory, 'installation.json')
  }

  async install(config: InjectionConfig): Promise<InstallationManifest> {
    ensureWindows(this.options.platform)
    if (!this.options.skipRunningCheck && isCursorRunning())
      throw new Error('Cursor 正在运行，请完全退出 Cursor 后重试')

    const paths = findCursorInstallation(this.options.cursorPath)
    const productText = await readFile(paths.productJsonPath, 'utf8')
    const originalHtml = await readFile(paths.workbenchHtmlPath, 'utf8')
    const product = JSON.parse(productText) as { version?: string, checksums?: Record<string, string> }
    const cursorVersion = product.version ?? 'unknown'
    const existingManifest = await this.readManifest()

    if (originalHtml.includes(injectionStart)) {
      if (!existingManifest)
        throw new Error('检测到未知的 Codex Sender 注入，缺少恢复清单，已停止修改')
      if (!sameWindowsPath(existingManifest.paths.appRoot, paths.appRoot))
        throw new Error('检测到另一个 Cursor 安装目录中的 Codex Sender 注入，已停止修改')
      await writeFile(paths.injectionScriptPath, createInjectionScript(config), 'utf8')
      const currentChecksum = sha256Base64(originalHtml)
      product.checksums ??= {}
      if (product.checksums[checksumKey] !== currentChecksum) {
        product.checksums[checksumKey] = currentChecksum
        await writeFile(paths.productJsonPath, `${JSON.stringify(product, null, 2)}\n`, 'utf8')
      }
      return existingManifest
    }

    const backupDirectory = path.join(
      this.options.dataDirectory,
      'backups',
      `${cursorVersion}-${sha256Hex(originalHtml).slice(0, 12)}`,
    )
    await mkdir(backupDirectory, { recursive: true })
    await copyFile(paths.workbenchHtmlPath, path.join(backupDirectory, 'workbench.html'))
    await copyFile(paths.productJsonPath, path.join(backupDirectory, 'product.json'))

    const patchedHtml = injectScriptTag(originalHtml)
    const patchedChecksum = sha256Base64(patchedHtml)
    product.checksums ??= {}
    product.checksums[checksumKey] = patchedChecksum

    try {
      await writeFile(paths.injectionScriptPath, createInjectionScript(config), 'utf8')
      await writeFile(paths.workbenchHtmlPath, patchedHtml, 'utf8')
      await writeFile(paths.productJsonPath, `${JSON.stringify(product, null, 2)}\n`, 'utf8')
    }
    catch (error) {
      await this.restoreBackups(paths, backupDirectory).catch(() => {})
      throw error
    }

    const manifest: InstallationManifest = {
      formatVersion: 1,
      cursorVersion,
      installedAt: new Date().toISOString(),
      paths,
      backupDirectory,
      originalWorkbenchSha256: sha256Hex(originalHtml),
      patchedWorkbenchSha256: sha256Hex(patchedHtml),
    }
    await mkdir(this.options.dataDirectory, { recursive: true })
    try {
      await atomicWriteJson(this.manifestPath, manifest)
    }
    catch (error) {
      await this.restoreBackups(paths, backupDirectory).catch(() => {})
      throw error
    }
    return manifest
  }

  async uninstall(): Promise<void> {
    ensureWindows(this.options.platform)
    if (!this.options.skipRunningCheck && isCursorRunning())
      throw new Error('Cursor 正在运行，请完全退出 Cursor 后重试')

    const manifest = await this.readManifest()
    if (!manifest)
      throw new Error('没有找到 Codex Sender 安装清单')

    const currentHtml = await readFile(manifest.paths.workbenchHtmlPath, 'utf8')
    const currentProductText = await readFile(manifest.paths.productJsonPath, 'utf8')

    if (sha256Hex(currentHtml) === manifest.patchedWorkbenchSha256) {
      await this.restoreBackups(manifest.paths, manifest.backupDirectory)
    }
    else if (currentHtml.includes(injectionStart)) {
      const cleanHtml = removeInjection(currentHtml)
      const product = JSON.parse(currentProductText) as { checksums?: Record<string, string> }
      product.checksums ??= {}
      product.checksums[checksumKey] = sha256Base64(cleanHtml)
      await writeFile(manifest.paths.workbenchHtmlPath, cleanHtml, 'utf8')
      await writeFile(manifest.paths.productJsonPath, `${JSON.stringify(product, null, 2)}\n`, 'utf8')
    }

    await rm(manifest.paths.injectionScriptPath, { force: true })
    await rm(this.manifestPath, { force: true })
  }

  async doctor(): Promise<DoctorReport> {
    const problems: string[] = []
    let paths: CursorInstallationPaths

    try {
      paths = findCursorInstallation(this.options.cursorPath)
    }
    catch (error) {
      return {
        ok: false,
        htmlInjected: false,
        injectionScriptPresent: false,
        checksumMatches: false,
        problems: [error instanceof Error ? error.message : String(error)],
      }
    }

    const product = JSON.parse(await readFile(paths.productJsonPath, 'utf8')) as { version?: string, checksums?: Record<string, string> }
    const html = await readFile(paths.workbenchHtmlPath, 'utf8')
    const htmlInjected = html.includes(injectionStart) && html.includes(injectionEnd)
    const injectionScriptPresent = existsSync(paths.injectionScriptPath)
    const checksumMatches = product.checksums?.[checksumKey] === sha256Base64(html)

    if (!htmlInjected)
      problems.push('workbench.html 尚未注入')
    if (!injectionScriptPresent)
      problems.push('注入脚本不存在')
    if (!checksumMatches)
      problems.push('Cursor workbench.html 校验值不匹配')

    return {
      ok: problems.length === 0,
      cursorVersion: product.version,
      appRoot: paths.appRoot,
      htmlInjected,
      injectionScriptPresent,
      checksumMatches,
      problems,
    }
  }

  async readManifest(): Promise<InstallationManifest | undefined> {
    try {
      return JSON.parse(await readFile(this.manifestPath, 'utf8')) as InstallationManifest
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return undefined
      throw error
    }
  }

  private async restoreBackups(paths: CursorInstallationPaths, backupDirectory: string): Promise<void> {
    await copyFile(path.join(backupDirectory, 'workbench.html'), paths.workbenchHtmlPath)
    await copyFile(path.join(backupDirectory, 'product.json'), paths.productJsonPath)
    await rm(paths.injectionScriptPath, { force: true })
  }
}

export function findCursorInstallation(explicitPath?: string): CursorInstallationPaths {
  const candidates = [explicitPath, process.env.CURSOR_APP_ROOT]

  if (process.platform === 'win32') {
    candidates.push(
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'cursor'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Cursor'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Cursor'),
    )
    const where = spawnSync('where.exe', ['cursor'], { encoding: 'utf8', windowsHide: true })
    if (where.status === 0)
      candidates.push(...where.stdout.split(/\r?\n/).filter(Boolean))
  }

  for (const candidate of candidates) {
    const root = candidate && findAppRootFromCandidate(candidate)
    if (root)
      return createInstallationPaths(root)
  }

  throw new Error('未找到 Cursor 安装目录，请使用 --cursor-path 显式指定 Cursor.exe 或 resources/app')
}

export function injectScriptTag(html: string): string {
  const clean = removeInjection(html)
  const tag = `${injectionStart}\n<script type="module" src="./${injectionFileName}"></script>\n${injectionEnd}`
  if (!clean.includes('</html>'))
    throw new Error('Cursor workbench.html 缺少 </html>，无法安全注入')
  return clean.replace('</html>', `${tag}\n</html>`)
}

export function removeInjection(html: string): string {
  const expression = new RegExp(`${escapeRegExp(injectionStart)}[\\s\\S]*?${escapeRegExp(injectionEnd)}\\s*`, 'g')
  return html.replace(expression, '')
}

function createInstallationPaths(appRoot: string): CursorInstallationPaths {
  const workbenchDirectory = path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench')
  return {
    appRoot,
    productJsonPath: path.join(appRoot, 'product.json'),
    workbenchHtmlPath: path.join(workbenchDirectory, 'workbench.html'),
    injectionScriptPath: path.join(workbenchDirectory, injectionFileName),
  }
}

function findAppRootFromCandidate(candidate: string): string | undefined {
  let current = path.resolve(candidate)
  if (!existsSync(current))
    return undefined
  if (statSync(current).isFile())
    current = path.dirname(current)

  for (let depth = 0; depth < 7; depth++) {
    if (isCursorAppRoot(current))
      return current
    const nested = path.join(current, 'resources', 'app')
    if (isCursorAppRoot(nested))
      return nested
    const parent = path.dirname(current)
    if (parent === current)
      break
    current = parent
  }
  return undefined
}

function isCursorAppRoot(candidate: string): boolean {
  return existsSync(path.join(candidate, 'product.json'))
    && existsSync(path.join(candidate, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'))
}

function isCursorRunning(): boolean {
  if (process.platform !== 'win32')
    return false
  const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq Cursor.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0 && /"Cursor\.exe"/i.test(result.stdout)
}

function ensureWindows(platform = process.platform): void {
  if (platform !== 'win32')
    throw new Error('当前补丁安装器仅支持 Windows Cursor')
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sha256Base64(value: string): string {
  return createHash('sha256').update(value).digest('base64').replace(/=+$/, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sameWindowsPath(first: string, second: string): boolean {
  return path.resolve(first).toLowerCase() === path.resolve(second).toLowerCase()
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
}
