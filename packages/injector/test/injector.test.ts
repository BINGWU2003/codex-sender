import { describe, expect, it } from 'vitest'
import { calculatePickerPlacement, createInjectionScript } from '../src/index.js'

describe('picker placement', () => {
  const baseInput = {
    anchorBottom: 124,
    anchorRight: 600,
    anchorTop: 100,
    desiredHeight: 420,
    desiredWidth: 340,
    gap: 6,
    margin: 8,
    viewportHeight: 800,
    viewportWidth: 800,
  }

  it('opens below the trigger when the popover fits', () => {
    expect(calculatePickerPlacement(baseInput)).toEqual({
      height: 420,
      left: 260,
      placement: 'bottom',
      top: 130,
      width: 340,
    })
  })

  it('flips above the trigger when only the upper side fits', () => {
    expect(calculatePickerPlacement({
      ...baseInput,
      anchorBottom: 674,
      anchorTop: 650,
    })).toMatchObject({ height: 420, placement: 'top', top: 224 })
  })

  it('uses the larger side and reduces height when neither side fits', () => {
    expect(calculatePickerPlacement({
      ...baseInput,
      anchorBottom: 274,
      anchorTop: 250,
      viewportHeight: 500,
    })).toMatchObject({ height: 236, placement: 'top', top: 8 })
  })

  it('clamps popover width and horizontal position to the viewport', () => {
    expect(calculatePickerPlacement({
      ...baseInput,
      anchorRight: 30,
      viewportWidth: 300,
    })).toMatchObject({ left: 8, width: 284 })
  })
})

describe('injection script generation', () => {
  it('embeds connection settings and stable Cursor selectors', () => {
    const source = createInjectionScript({ port: 47321, token: 'secret-token', version: '0.1.0' })
    const normalizedSource = source.replaceAll('\\"', '"')

    expect(source).toContain('127.0.0.1:')
    expect(source).toContain('secret-token')
    expect(normalizedSource).toContain('.composer-unified-dropdown[data-mode]')
    expect(normalizedSource).toContain('insertAdjacentElement("afterend"')
    expect(normalizedSource).not.toContain('.composer-bar')
    expect(normalizedSource).not.toContain('data-composer-location')
    expect(normalizedSource).toContain('.aislash-editor-input[contenteditable="true"]')
    expect(normalizedSource).not.toContain('.ui-prompt-input-editor__input')
    expect(normalizedSource).not.toContain('.ProseMirror[contenteditable="true"]')
    expect(source).toContain('picker.style.top')
    expect(source).toContain('calculatePlacement')
    expect(source).toContain('codexSenderPlacement')
    expect(source).toContain('codexSenderThreadList')
    expect(source).toContain('overflow-y: auto')
    expect(source).toContain('schedulePickerPosition')
    expect(source).toContain('/api/settings')
    expect(source).toContain('/health')
    expect(source).toContain('Bridge 版本')
    expect(source).toContain('请重启 Bridge 后重试')
    expect(source).toContain('打开并自动粘贴')
    expect(source).toContain('打开、自动粘贴并发送')
    expect(source).toContain('paste-and-send')
    expect(source).toContain('交接后处理')
    expect(source).toContain('成功交接后清空 Cursor 输入框')
    expect(source).toContain('clearCursorPromptAfterHandoff')
    expect(source).toContain('createChevronDownIcon')
    expect(source).toContain('M4 6.5 8 10l4-3.5')
    expect(source).not.toContain('⌄')
    expect(source).toContain('codexSenderTaskView')
    expect(source).toContain('codexSenderSettingsView')
    expect(source).toContain('codexSenderActiveView')
    expect(source).toContain('交接设置')
    expect(source).toContain('返回任务')
    expect(source.indexOf('新建 Codex 任务')).toBeLessThan(source.indexOf('打开并复制（推荐）'))
    expect(source).toContain('pointerdown')
    expect(source).toContain('event.key')
    expect(source).toContain('Escape')
    expect(source).toContain('closePicker()')
    expect(source).not.toContain('openThreadPicker(new MouseEvent')
    expect(source).toContain('/api/copy-cursor-prompt')
    expect(source).toContain('/api/log')
    expect(source).toContain('cursor_copy_prepared')
    expect(source).toContain('richNodes')
    expect(source).toContain('expectsFileReferences')
    expect(source).not.toContain('document.execCommand("copy")')
    expect(source).not.toContain('/api/jobs/')
    expect(source).toContain('MutationObserver')
  })
})
