export interface WorkspaceThreadBinding {
  activeThreadId: string
  title: string
  updatedAt?: string
}

export interface CodexSenderState {
  version: 1
  port: number
  token: string
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
