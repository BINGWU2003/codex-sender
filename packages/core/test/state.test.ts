import { describe, expect, it } from 'vitest'
import { normalizeWorkspacePath } from '../src/index.js'

describe('workspace path normalization', () => {
  it('normalizes Windows paths for stable state keys', () => {
    expect(normalizeWorkspacePath('D:/Work/Demo/')).toBe('d:\\work\\demo')
    expect(normalizeWorkspacePath('D:/')).toBe('d:\\')
  })

  it('preserves the POSIX root path', () => {
    expect(normalizeWorkspacePath('/', false)).toBe('/')
  })
})
