import type { CodeReference, WorkspaceThreadBinding } from '@codex-sender/core'
import type { WebviewView, WebviewViewProvider } from 'vscode'
import process from 'node:process'
import { AppServerClient } from '@codex-sender/app-server-client'
import { buildCodexPrompt, formatCodeReferenceLabel } from '@codex-sender/core'
import * as vscode from 'vscode'

const viewId = 'codexSender.panel'
const threadBindingsKey = 'codexSender.threadBindings'

export function activate(context: vscode.ExtensionContext): void {
  const appServer = new AppServerClient()
  const provider = new SenderViewProvider(
    appServer,
    context.globalState,
    String(context.extension.packageJSON.version),
  )

  context.subscriptions.push(
    appServer,
    vscode.window.registerWebviewViewProvider(viewId, provider),
    vscode.commands.registerCommand('codexSender.openPanel', async () => {
      await vscode.commands.executeCommand(`${viewId}.focus`)
    }),
    vscode.commands.registerCommand('codexSender.addSelection', async () => {
      const reference = getCurrentCodeReference()

      if (!reference) {
        await vscode.window.showWarningMessage('请先在编辑器中选择一段代码。')
        return
      }

      provider.addReference(reference)
      await vscode.commands.executeCommand(`${viewId}.focus`)
    }),
  )
}

export function deactivate(): void {}

function getCurrentCodeReference(): CodeReference | undefined {
  const editor = vscode.window.activeTextEditor

  if (!editor || editor.selection.isEmpty)
    return undefined

  const document = editor.document
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)

  return {
    workspacePath: workspaceFolder?.uri.fsPath ?? '',
    relativeFilePath: vscode.workspace.asRelativePath(document.uri, false),
    languageId: document.languageId,
    startLine: editor.selection.start.line + 1,
    endLine: editor.selection.end.line + 1,
    selectedText: document.getText(editor.selection),
    documentVersion: document.version,
  }
}

class SenderViewProvider implements WebviewViewProvider {
  private references: CodeReference[] = []
  private sendQueue = Promise.resolve()
  private view?: WebviewView

  constructor(
    private readonly appServer: AppServerClient,
    private readonly globalState: vscode.Memento,
    private readonly extensionVersion: string,
  ) {}

  resolveWebviewView(view: WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = renderWebviewHtml(view.webview)
    view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isWebviewMessage(message))
        return

      if (message.type === 'ready') {
        await this.syncState()
        return
      }

      if (message.type === 'remove' && typeof message.index === 'number') {
        this.references.splice(message.index, 1)
        await this.syncState()
        return
      }

      if (message.type === 'clear') {
        this.references = []
        await this.syncState()
        return
      }

      if (message.type === 'preview' && typeof message.question === 'string')
        await this.openPromptPreview(message.question)

      if (message.type === 'send' && typeof message.question === 'string')
        this.enqueueSend(message.question)
    })
  }

  addReference(reference: CodeReference): void {
    this.references.push(reference)
    void this.syncState()
  }

  private async syncState(): Promise<void> {
    await this.view?.webview.postMessage({
      type: 'state',
      references: this.references.map(formatCodeReferenceLabel),
    })
  }

  private async openPromptPreview(question: string): Promise<void> {
    if (!question.trim()) {
      await vscode.window.showWarningMessage('请输入要发送给 Codex 的问题。')
      return
    }

    const prompt = buildCodexPrompt({ question, references: this.references })
    const document = await vscode.workspace.openTextDocument({
      content: prompt,
      language: 'markdown',
    })
    await vscode.window.showTextDocument(document, { preview: true })
  }

  private enqueueSend(question: string): void {
    this.sendQueue = this.sendQueue
      .then(() => this.sendToCodex(question))
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        await this.postStatus(false, `发送失败：${message}`)
        await vscode.window.showErrorMessage(`Codex Sender：${message}`)
      })
  }

  private async sendToCodex(question: string): Promise<void> {
    if (!question.trim()) {
      await vscode.window.showWarningMessage('请输入要发送给 Codex 的问题。')
      return
    }

    const workspacePath = this.references.find(reference => reference.workspacePath)?.workspacePath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

    if (!workspacePath) {
      await vscode.window.showWarningMessage('请先打开一个工作区。')
      return
    }

    await this.postStatus(true, '正在连接 Codex…')
    await this.appServer.initialize({
      name: 'codex_sender',
      title: 'Codex Sender',
      version: this.extensionVersion,
    })

    const key = normalizeWorkspacePath(workspacePath)
    const bindings = this.globalState.get<Record<string, WorkspaceThreadBinding>>(threadBindingsKey, {})
    const existingBinding = bindings[key]
    const response = existingBinding
      ? await this.appServer.resumeThread({ threadId: existingBinding.activeThreadId, cwd: workspacePath })
      : await this.appServer.startThread({ cwd: workspacePath })
    const threadId = response.thread.id

    if (!existingBinding) {
      await this.globalState.update(threadBindingsKey, {
        ...bindings,
        [key]: {
          activeThreadId: threadId,
          title: createThreadTitle(question),
        },
      })
    }

    const prompt = buildCodexPrompt({ question, references: this.references })
    await this.postStatus(true, '正在发送消息…')
    await this.appServer.startTextTurn({ threadId, text: prompt, cwd: workspacePath })

    this.references = []
    await this.syncState()
    await this.postStatus(false, `已发送到任务 ${threadId}`)
    await vscode.window.showInformationMessage('消息已发送到 Codex，请在 Codex App 中查看进度。')
  }

  private async postStatus(sending: boolean, message: string): Promise<void> {
    await this.view?.webview.postMessage({ type: 'status', sending, message })
  }
}

interface WebviewMessage {
  type: 'clear' | 'preview' | 'ready' | 'remove' | 'send'
  index?: number
  question?: string
}

function isWebviewMessage(value: unknown): value is WebviewMessage {
  return Boolean(value && typeof value === 'object' && 'type' in value)
}

function normalizeWorkspacePath(workspacePath: string): string {
  const normalized = workspacePath.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.replaceAll('/', '\\').toLowerCase() : normalized
}

function createThreadTitle(question: string): string {
  const firstLine = question.trim().split(/\r?\n/, 1)[0]
  return firstLine.slice(0, 80) || 'Codex Sender 任务'
}

function renderWebviewHtml(webview: vscode.Webview): string {
  const nonce = createNonce()
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>
    body { padding: 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    #references { display: grid; gap: 6px; margin-bottom: 10px; }
    .reference { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: var(--vscode-textBlockQuote-background); border-radius: 4px; }
    .reference span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    textarea { box-sizing: border-box; width: 100%; min-height: 120px; resize: vertical; padding: 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
    .status { min-height: 18px; margin-top: 8px; color: var(--vscode-descriptionForeground); }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    button { padding: 6px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; cursor: pointer; }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .empty { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div id="references"><span class="empty">还没有代码片段</span></div>
  <textarea id="question" placeholder="输入要发送给 Codex 的问题"></textarea>
  <div id="status" class="status"></div>
  <div class="actions">
    <button id="clear" class="secondary">清空上下文</button>
    <button id="preview" class="secondary">预览消息</button>
    <button id="send">发送到 Codex</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi()
    const references = document.getElementById('references')
    const question = document.getElementById('question')
    const status = document.getElementById('status')
    const send = document.getElementById('send')
    document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }))
    document.getElementById('preview').addEventListener('click', () => vscode.postMessage({ type: 'preview', question: question.value }))
    send.addEventListener('click', () => vscode.postMessage({ type: 'send', question: question.value }))
    window.addEventListener('message', ({ data }) => {
      if (data.type === 'status') {
        status.textContent = data.message
        send.disabled = data.sending
        return
      }
      if (data.type !== 'state') return
      references.replaceChildren()
      if (data.references.length === 0) {
        const empty = document.createElement('span')
        empty.className = 'empty'
        empty.textContent = '还没有代码片段'
        references.append(empty)
        return
      }
      data.references.forEach((label, index) => {
        const row = document.createElement('div')
        row.className = 'reference'
        const text = document.createElement('span')
        text.textContent = label
        const remove = document.createElement('button')
        remove.className = 'secondary'
        remove.textContent = '×'
        remove.title = '移除代码片段'
        remove.addEventListener('click', () => vscode.postMessage({ type: 'remove', index }))
        row.append(text, remove)
        references.append(row)
      })
    })
    vscode.postMessage({ type: 'ready' })
  </script>
</body>
</html>`
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 32 }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('')
}
