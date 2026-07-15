import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { runInstallWizard, shouldRunInstallWizard, validatePort } = await import('../src/install-wizard.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('install wizard', () => {
  it('collects editable path, port, and space-selected install features', async () => {
    promptMocks.text
      .mockResolvedValueOnce('D:\\Program Files\\Cursor\\Cursor.exe')
      .mockResolvedValueOnce('48123')
    promptMocks.multiselect.mockResolvedValueOnce(['start-bridge'])
    promptMocks.confirm.mockResolvedValueOnce(true)

    const result = await runInstallWizard({
      cursorPath: 'C:\\Users\\User\\AppData\\Local\\Programs\\Cursor\\Cursor.exe',
      port: 47_321,
      registerStartup: true,
      startBridge: true,
    })

    expect(result).toEqual({
      cursorPath: 'D:\\Program Files\\Cursor\\Cursor.exe',
      port: 48_123,
      registerStartup: false,
      startBridge: true,
    })
    expect(promptMocks.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: ['startup', 'start-bridge'],
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
      startBridge: true,
    })).resolves.toBeUndefined()
    expect(promptMocks.cancel).toHaveBeenCalledOnce()
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
})
