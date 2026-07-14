import { describe, expect, it } from 'vitest'
import { createInjectionScript } from '../src/index.js'

describe('injection script generation', () => {
  it('embeds connection settings and stable Cursor selectors', () => {
    const source = createInjectionScript({ port: 47321, token: 'secret-token', version: '0.1.0' })
    const normalizedSource = source.replaceAll('\\"', '"')

    expect(source).toContain('127.0.0.1:')
    expect(source).toContain('secret-token')
    expect(normalizedSource).toContain('button[aria-label="Send message"]')
    expect(normalizedSource).toContain('.ProseMirror[contenteditable="true"]')
    expect(source).toContain('MutationObserver')
  })
})
