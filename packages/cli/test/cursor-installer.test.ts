import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CursorInstaller, findCursorInstallation, injectScriptTag, removeInjection } from '../src/cursor-installer.js'

const originalHtml = '<!doctype html>\n<html><body></body><script src="./workbench.js" type="module"></script></html>\n'

describe('cursor HTML patching', () => {
  it('is reversible and idempotent', () => {
    const injected = injectScriptTag(originalHtml)
    expect(injected).toContain('codex-sender.inject.js')
    expect(injectScriptTag(injected).match(/codex-sender:start/g)).toHaveLength(1)
    expect(removeInjection(injected)).toBe(originalHtml)
  })

  it('does not fall back to another installation for an invalid explicit path', () => {
    expect(() => findCursorInstallation(path.join(tmpdir(), 'missing-cursor-installation'))).toThrow('指定路径不是有效的 Cursor 安装')
  })
})

describe('cursor installer', () => {
  it('backs up, patches, verifies, and restores a Cursor fixture', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-sender-cursor-'))
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-data-'))
    const workbenchDirectory = path.join(root, 'out', 'vs', 'code', 'electron-sandbox', 'workbench')
    await mkdir(workbenchDirectory, { recursive: true })
    const checksum = createHash('sha256').update(originalHtml).digest('base64').replace(/=+$/, '')
    const product = {
      version: 'fixture-1.0.0',
      checksums: { 'vs/code/electron-sandbox/workbench/workbench.html': checksum },
    }
    await writeFile(path.join(root, 'product.json'), `${JSON.stringify(product, null, 2)}\n`)
    await writeFile(path.join(workbenchDirectory, 'workbench.html'), originalHtml)
    const installer = new CursorInstaller({ dataDirectory, cursorPath: root, platform: 'win32', skipRunningCheck: true })

    await installer.install({ port: 47_321, token: 'fixture-token', version: '0.1.0' })
    expect(await installer.doctor()).toMatchObject({ ok: true, cursorVersion: 'fixture-1.0.0' })
    expect(await readFile(path.join(workbenchDirectory, 'codex-sender.inject.js'), 'utf8')).toContain('fixture-token')

    const patchedProduct = JSON.parse(await readFile(path.join(root, 'product.json'), 'utf8')) as typeof product
    expect(patchedProduct.checksums['vs/code/electron-sandbox/workbench/workbench.html']).not.toMatch(/=$/)

    patchedProduct.checksums['vs/code/electron-sandbox/workbench/workbench.html'] = 'invalid'
    await writeFile(path.join(root, 'product.json'), `${JSON.stringify(patchedProduct, null, 2)}\n`)
    await installer.install({ port: 47_321, token: 'rotated-token', version: '0.1.1' })
    expect(await installer.doctor()).toMatchObject({ ok: true })
    expect(await readFile(path.join(workbenchDirectory, 'codex-sender.inject.js'), 'utf8')).toContain('rotated-token')

    await installer.uninstall()
    expect(await readFile(path.join(workbenchDirectory, 'workbench.html'), 'utf8')).toBe(originalHtml)
    expect(JSON.parse(await readFile(path.join(root, 'product.json'), 'utf8'))).toEqual(product)
  })
})
