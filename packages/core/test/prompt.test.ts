import { describe, expect, it } from 'vitest'
import { buildCodexPrompt, formatCodeReferenceLabel } from '../src/index.js'

const reference = {
  workspacePath: 'd:\\work\\demo',
  relativeFilePath: 'src/App.tsx',
  languageId: 'tsx',
  startLine: 8,
  endLine: 22,
  selectedText: 'export function App() {}',
  documentVersion: 1,
}

describe('code reference formatting', () => {
  it('formats the compact reference label', () => {
    expect(formatCodeReferenceLabel(reference)).toBe('@src/App.tsx (8-22)')
  })

  it('builds a prompt with source metadata and fenced code', () => {
    expect(buildCodexPrompt({
      question: '分析这段代码',
      references: [reference],
    })).toContain('分析这段代码\n\n片段 1\n文件：src/App.tsx\n行号：8-22\n\n```tsx')
  })
})
