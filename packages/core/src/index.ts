export interface CodeReference {
  workspacePath: string
  relativeFilePath: string
  languageId: string
  startLine: number
  endLine: number
  selectedText: string
  documentVersion: number
}

export interface CodexMessageRequest {
  question: string
  references: readonly CodeReference[]
}

export interface WorkspaceThreadBinding {
  activeThreadId: string
  title: string
}

export function formatCodeReferenceLabel(reference: CodeReference): string {
  return `@${reference.relativeFilePath} (${reference.startLine}-${reference.endLine})`
}

export function buildCodexPrompt(request: CodexMessageRequest): string {
  const question = request.question.trim()
  const sections = request.references.map((reference, index) => {
    const language = reference.languageId || 'text'

    return [
      `片段 ${index + 1}`,
      `文件：${reference.relativeFilePath}`,
      `行号：${reference.startLine}-${reference.endLine}`,
      '',
      `\`\`\`${language}`,
      reference.selectedText,
      '\`\`\`',
    ].join('\n')
  })

  return [question, ...sections].filter(Boolean).join('\n\n')
}
