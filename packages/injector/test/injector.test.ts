import { describe, expect, it } from 'vitest'
import { createInjectionScript } from '../src/index.js'

describe('injection script generation', () => {
  it('embeds connection settings and stable Cursor selectors', () => {
    const source = createInjectionScript({ port: 47321, token: 'secret-token', version: '0.1.0' })
    const normalizedSource = source.replaceAll('\\"', '"')

    expect(source).toContain('127.0.0.1:')
    expect(source).toContain('secret-token')
    expect(normalizedSource).toContain('.composer-bar[data-composer-location="pane"]')
    expect(normalizedSource).toContain('.aislash-editor-input[contenteditable="true"]')
    expect(normalizedSource).not.toContain('.ui-prompt-input-editor__input')
    expect(normalizedSource).not.toContain('.ProseMirror[contenteditable="true"]')
    expect(source).toContain('picker.style.top')
    expect(source).toContain('rect.bottom + 6')
    expect(source).toContain('/api/settings')
    expect(source).toContain('打开并自动粘贴')
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
