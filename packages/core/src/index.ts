export interface WorkspaceThreadBinding {
  activeThreadId: string
  title: string
  updatedAt?: string
}

export type DeliveryMode = 'copy' | 'paste' | 'paste-and-send'

export interface CodexSenderSettings {
  clearCursorPromptAfterHandoff: boolean
  deliveryMode: DeliveryMode
}

export interface CodexSenderState {
  version: 3
  port: number
  token: string
  settings: CodexSenderSettings
  workspaces: Record<string, WorkspaceThreadBinding>
}

export function normalizeWorkspacePath(workspacePath: string, windows = /^[a-z]:[\\/]/i.test(workspacePath)): string {
  const withoutTrailingSeparators = workspacePath.replace(/[\\/]+$/, '')

  if (windows) {
    const normalized = withoutTrailingSeparators.replaceAll('/', '\\').toLowerCase()
    return /^[a-z]:$/i.test(normalized) ? `${normalized}\\` : normalized
  }

  return withoutTrailingSeparators || (workspacePath.startsWith('/') ? '/' : '')
}
