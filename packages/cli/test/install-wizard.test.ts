import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const promptMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  multiselect: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
}))

vi.mock('@clack/prompts', () => ({
  ...promptMocks,
  isCancel: (value: unknown) => typeof value === 'symbol',
}))

const { runInstallWizard, shouldRunInstallWizard, suggestCursorPath, validatePort } = await import('../src/install-wizard.js')

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('install wizard', () => {
  it('collects editable path, port, and space-selected install features', async () => {
    promptMocks.text
      .mockResolvedValueOnce('D:\\Program Files\\Cursor\\Cursor.exe')
      .mockResolvedValueOnce('48123')
    promptMocks.multiselect.mockResolvedValueOnce([])
    promptMocks.confirm.mockResolvedValueOnce(true)

    const result = await runInstallWizard({
      cursorPath: 'C:\\Users\\User\\AppData\\Local\\Programs\\Cursor\\Cursor.exe',
      port: 47_321,
      registerStartup: true,
    })

    expect(result).toEqual({
      cursorPath: 'D:\\Program Files\\Cursor\\Cursor.exe',
      port: 48_123,
      registerStartup: false,
    })
    expect(promptMocks.text).toHaveBeenNthCalledWith(1, expect.objectContaining({
      initialValue: 'C:\\Users\\User\\AppData\\Local\\Programs\\Cursor\\Cursor.exe',
    }))
    expect(promptMocks.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: ['startup'],
      required: false,
      showInstructions: true,
    }))
    expect(promptMocks.note).toHaveBeenCalledOnce()
    expect(promptMocks.outro).toHaveBeenCalledOnce()
  })

  it('cancels without returning an install configuration', async () => {
    promptMocks.text.mockResolvedValueOnce(Symbol('cancel'))

    await expect(runInstallWizard({
      port: 47_321,
      registerStartup: true,
    })).resolves.toBeUndefined()
    expect(promptMocks.cancel).toHaveBeenCalledOnce()
    expect(promptMocks.multiselect).not.toHaveBeenCalled()
  })

  it('treats --no-startup as deterministic and skips the startup prompt', async () => {
    promptMocks.text
      .mockResolvedValueOnce('D:\\Program Files\\Cursor\\Cursor.exe')
      .mockResolvedValueOnce('47321')
    promptMocks.confirm.mockResolvedValueOnce(true)

    await expect(runInstallWizard({
      allowStartup: false,
      port: 47_321,
      registerStartup: false,
    })).resolves.toMatchObject({ registerStartup: false })
    expect(promptMocks.multiselect).not.toHaveBeenCalled()
  })

  it('only starts the wizard in an interactive terminal', () => {
    expect(shouldRunInstallWizard([], true, true)).toBe(true)
    expect(shouldRunInstallWizard(['--non-interactive'], true, true)).toBe(false)
    expect(shouldRunInstallWizard([], false, true)).toBe(false)
    expect(shouldRunInstallWizard([], true, false)).toBe(false)
  })

  it('validates the Bridge port range', () => {
    expect(validatePort('47321')).toBeUndefined()
    expect(validatePort('0')).toContain('1-65535')
    expect(validatePort('abc')).toContain('1-65535')
  })

  it('prefers an explicit Cursor path over the saved installation', async () => {
    await expect(
      suggestCursorPath('D:\\explicit\\Cursor.exe', path.join(tmpdir(), 'unused-data')),
    ).resolves.toBe('D:\\explicit\\Cursor.exe')
  })

  it('reuses a valid Cursor path from installation.json', async () => {
    const cursorRoot = await createCursorFixture()
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-saved-path-'))
    await writeFile(path.join(dataDirectory, 'installation.json'), JSON.stringify({
      paths: { appRoot: cursorRoot },
    }))

    await expect(suggestCursorPath(undefined, dataDirectory)).resolves.toBe(cursorRoot)
  })

  it('falls back to discovery when the saved Cursor path is stale', async () => {
    const cursorRoot = await createCursorFixture()
    const dataDirectory = await mkdtemp(path.join(tmpdir(), 'codex-sender-stale-path-'))
    await writeFile(path.join(dataDirectory, 'installation.json'), JSON.stringify({
      paths: { appRoot: path.join(tmpdir(), 'missing-cursor') },
    }))
    vi.stubEnv('CURSOR_APP_ROOT', cursorRoot)

    await expect(suggestCursorPath(undefined, dataDirectory)).resolves.toBe(cursorRoot)
  })
})

async function createCursorFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-sender-cursor-path-'))
  const workbenchDirectory = path.join(root, 'out', 'vs', 'code', 'electron-sandbox', 'workbench')
  await mkdir(workbenchDirectory, { recursive: true })
  await writeFile(path.join(root, 'product.json'), '{}')
  await writeFile(path.join(workbenchDirectory, 'workbench.html'), '<html></html>')
  return root
}
