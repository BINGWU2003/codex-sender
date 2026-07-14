export interface InjectionConfig {
  port: number
  token: string
  version: string
}

export function createInjectionScript(config: InjectionConfig): string {
  return `;(${injectedMain.toString()})(${JSON.stringify(config)});\n`
}

function injectedMain(config: InjectionConfig): void {
  const markerAttribute = 'data-codex-sender'
  const editorSelector = '.aislash-editor-input[contenteditable="true"]'
  const composerSelector = '.composer-bar[data-composer-location="pane"]'
  const sendButtonSelector = '.composer-bar[data-composer-location="pane"] button'
  const apiBase = `http://127.0.0.1:${config.port}`
  let picker: HTMLElement | undefined

  addStyles()
  mountButtons()
  new MutationObserver(mountButtons).observe(document.body, { childList: true, subtree: true })

  function addStyles(): void {
    if (document.querySelector('style[data-codex-sender-style]'))
      return

    const style = document.createElement('style')
    style.dataset.codexSenderStyle = config.version
    style.textContent = `
      [data-codex-sender-group] { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 2px; margin-right: 4px; }
      [data-codex-sender-button], [data-codex-sender-picker-button] { box-sizing: border-box; width: auto !important; height: 24px; border: 0; border-radius: 6px; cursor: pointer; }
      [data-codex-sender-button] { min-width: 48px !important; padding: 0 7px !important; color: var(--vscode-button-foreground, #fff) !important; background: var(--vscode-button-background, #0e639c) !important; font-weight: 600; }
      [data-codex-sender-picker-button] { min-width: 20px !important; padding: 0 4px !important; color: var(--vscode-foreground) !important; background: transparent !important; }
      [data-codex-sender-button]:hover { background: var(--vscode-button-hoverBackground, #1177bb) !important; }
      [data-codex-sender-picker-button]:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)) !important; }
      [data-codex-sender-state="sending"] { opacity: .65; }
      [data-codex-sender-state="success"] { color: var(--vscode-testing-iconPassed, #4caf50) !important; }
      [data-codex-sender-state="error"] { color: var(--vscode-testing-iconFailed, #f44336) !important; }
      [data-codex-sender-popover] { position: fixed; z-index: 100000; width: 340px; max-height: 420px; overflow: auto; padding: 8px; color: var(--vscode-foreground); background: var(--vscode-menu-background, #252526); border: 1px solid var(--vscode-menu-border, #454545); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35); font: 12px var(--vscode-font-family); }
      [data-codex-sender-item] { display: block; width: 100%; padding: 8px; color: inherit; background: transparent; border: 0; border-radius: 4px; text-align: left; cursor: pointer; }
      [data-codex-sender-item]:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
      [data-codex-sender-item][data-active="true"] { color: var(--vscode-testing-iconPassed, #4caf50); }
      [data-codex-sender-item] small { display: block; margin-top: 3px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      [data-codex-sender-heading] { padding: 6px 8px; opacity: .7; }
      [data-codex-sender-divider] { height: 1px; margin: 6px 4px; background: var(--vscode-menu-separatorBackground, #454545); }
    `
    document.head.append(style)
  }

  function mountButtons(): void {
    for (const editor of document.querySelectorAll<HTMLElement>(editorSelector)) {
      const composer = editor.closest<HTMLElement>(composerSelector)
      const cursorSendButton = composer?.querySelector<HTMLButtonElement>(sendButtonSelector)
      const parent = cursorSendButton?.parentElement

      if (!composer || !cursorSendButton || !parent || composer.querySelector(`[${markerAttribute}]`))
        continue

      const group = document.createElement('span')
      group.setAttribute(markerAttribute, config.version)
      group.dataset.codexSenderGroup = ''

      const sendButton = createToolbarButton(cursorSendButton, 'Codex', '交接到 Codex App')
      sendButton.dataset.codexSenderButton = ''
      sendButton.addEventListener('click', event => void sendToCodex(event, composer, sendButton))

      const pickerButton = createToolbarButton(cursorSendButton, '⌄', '选择 Codex 任务')
      pickerButton.dataset.codexSenderPickerButton = ''
      pickerButton.addEventListener('click', event => void openThreadPicker(event, composer, pickerButton))

      group.append(sendButton, pickerButton)
      const anchor = findDirectChild(parent, cursorSendButton)
      parent.insertBefore(group, anchor)
    }
  }

  function findDirectChild(parent: HTMLElement, descendant: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = descendant
    while (current?.parentElement && current.parentElement !== parent)
      current = current.parentElement
    return current?.parentElement === parent ? current : null
  }

  function createToolbarButton(template: HTMLButtonElement, label: string, title: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = template.className
    button.textContent = label
    button.title = title
    button.setAttribute('aria-label', title)
    return button
  }

  async function sendToCodex(event: Event, composer: HTMLElement, button: HTMLButtonElement): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    let restoreEditorState: (() => void) | undefined

    try {
      setButtonState(button, 'sending', '正在读取 Cursor 输入框…')
      const editor = composer.querySelector<HTMLElement>(editorSelector)
      if (!editor)
        throw new Error('未找到 Cursor 输入框')
      const prepared = prepareNativeCopy(editor)
      restoreEditorState = prepared.restore
      void logEvent('info', 'cursor_copy_prepared', prepared.diagnostics)
      if (!prepared.fallbackText.trim())
        throw new Error('Cursor 输入框为空')

      const copyResult = await request('/api/copy-cursor-prompt', {
        method: 'POST',
        body: JSON.stringify({
          fallbackText: prepared.fallbackText,
          expectsFileReferences: prepared.expectsFileReferences,
        }),
      }) as { text: string }
      restoreEditorState()
      restoreEditorState = undefined

      const cwd = await getWorkspacePath()
      const result = await request('/api/send', {
        method: 'POST',
        body: JSON.stringify({ cwd, text: copyResult.text }),
      }) as { message: string, warning?: string }
      setButtonState(button, 'success', result.warning ? `${result.message}；${result.warning}` : result.message)
    }
    catch (error) {
      setButtonState(button, 'error', getErrorMessage(error))
      void logEvent('error', 'cursor_send_failed', { message: getErrorMessage(error) })
    }
    finally {
      restoreEditorState?.()
    }
  }

  function prepareNativeCopy(editor: HTMLElement): {
    diagnostics: object
    expectsFileReferences: boolean
    fallbackText: string
    restore: () => void
  } {
    const selection = document.getSelection()
    const savedRanges: Range[] = []
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const richNodes = [...editor.querySelectorAll<HTMLElement>('[contenteditable="false"]')]
    const expectsFileReferences = richNodes.length > 0

    if (selection) {
      for (let index = 0; index < selection.rangeCount; index++)
        savedRanges.push(selection.getRangeAt(index).cloneRange())
    }

    editor.focus({ preventScroll: true })

    const restore = (): void => {
      if (selection) {
        selection.removeAllRanges()
        for (const range of savedRanges)
          selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      }
      previouslyFocused?.focus({ preventScroll: true })
    }

    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    const fallbackText = editor.innerText
    return {
      diagnostics: {
        expectsFileReferences,
        fallbackLength: fallbackText.length,
        savedRangeCount: savedRanges.length,
        richNodeCount: richNodes.length,
        richNodes: richNodes.slice(0, 20).map(node => describeRichNode(node, editor)),
      },
      expectsFileReferences,
      fallbackText,
      restore,
    }
  }

  function describeRichNode(node: HTMLElement, editor: HTMLElement): object {
    const lineage: object[] = []
    let current: HTMLElement | null = node

    for (let depth = 0; current && current !== editor && depth < 5; depth++, current = current.parentElement) {
      const attributes = Object.fromEntries([...current.attributes]
        .filter(attribute => attribute.name === 'contenteditable'
          || attribute.name === 'title'
          || attribute.name === 'role'
          || attribute.name.startsWith('aria-')
          || attribute.name.startsWith('data-'))
        .slice(0, 30)
        .map(attribute => [attribute.name, attribute.value.slice(0, 500)]))
      lineage.push({
        tag: current.tagName.toLowerCase(),
        className: current.className.slice(0, 500),
        attributes,
      })
    }

    return {
      label: (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').slice(0, 200),
      lineage,
    }
  }

  async function openThreadPicker(event: MouseEvent, composer: HTMLElement, button: HTMLButtonElement): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    picker?.remove()

    picker = document.createElement('div')
    picker.dataset.codexSenderPopover = ''
    picker.textContent = '正在加载 Codex 历史任务…'
    document.body.append(picker)
    positionPicker(button)

    try {
      const cwd = await getWorkspacePath()
      const result = await request(`/api/threads?cwd=${encodeURIComponent(cwd)}`) as {
        data: Array<{ id: string, name: string | null, preview: string, cwd: string, source: unknown, updatedAt: number }>
        binding?: { activeThreadId: string, title: string }
        settings: { deliveryMode: 'copy' | 'paste' }
      }
      renderThreadPicker(result, cwd, composer)
    }
    catch (error) {
      picker.textContent = getErrorMessage(error)
    }
  }

  function renderThreadPicker(result: {
    data: Array<{ id: string, name: string | null, preview: string, cwd: string, source: unknown, updatedAt: number }>
    binding?: { activeThreadId: string, title: string }
    settings: { deliveryMode: 'copy' | 'paste' }
  }, cwd: string, composer: HTMLElement): void {
    if (!picker)
      return

    picker.replaceChildren()
    const heading = document.createElement('div')
    heading.dataset.codexSenderHeading = ''
    heading.textContent = result.binding ? `当前任务：${result.binding.title}` : '当前任务：新建 Codex 任务'
    picker.append(heading)

    const create = createPickerItem(`${result.binding ? '＋' : '✓'} 新建 Codex 任务`, '下次点击 Codex 时打开带预填提示词的新任务')
    create.dataset.active = String(!result.binding)
    create.addEventListener('click', () => void updateBinding('/api/unbind', { cwd }, composer))
    picker.append(create)

    for (const thread of result.data) {
      const title = thread.name?.trim() || thread.preview.trim().split(/\r?\n/, 1)[0] || '未命名任务'
      const detail = `${thread.cwd} · ${new Date(thread.updatedAt * 1000).toLocaleString()}`
      const active = result.binding?.activeThreadId === thread.id
      const item = createPickerItem(`${active ? '✓ ' : ''}${title}`, detail)
      item.dataset.active = String(active)
      item.addEventListener('click', () => void updateBinding('/api/bind', {
        cwd,
        threadId: thread.id,
        title,
      }, composer))
      picker.append(item)
    }

    if (result.data.length === 0) {
      const empty = document.createElement('div')
      empty.dataset.codexSenderHeading = ''
      empty.textContent = '没有找到历史任务'
      picker.append(empty)
    }

    const divider = document.createElement('div')
    divider.dataset.codexSenderDivider = ''
    picker.append(divider)

    const modeHeading = document.createElement('div')
    modeHeading.dataset.codexSenderHeading = ''
    modeHeading.textContent = '历史任务的提示词交接方式'
    picker.append(modeHeading)

    const copyMode = createPickerItem(`${result.settings.deliveryMode === 'copy' ? '✓ ' : ''}打开并复制（推荐）`, '打开任务后由你按 Ctrl+V，再确认发送')
    copyMode.dataset.active = String(result.settings.deliveryMode === 'copy')
    copyMode.addEventListener('click', () => void updateSettings('copy', cwd, composer))
    picker.append(copyMode)

    const pasteMode = createPickerItem(`${result.settings.deliveryMode === 'paste' ? '✓ ' : ''}打开并自动粘贴（实验）`, '使用 Windows 辅助功能定位输入框；仍由你按 Enter')
    pasteMode.dataset.active = String(result.settings.deliveryMode === 'paste')
    pasteMode.addEventListener('click', () => void updateSettings('paste', cwd, composer))
    picker.append(pasteMode)
  }

  function createPickerItem(title: string, detail: string): HTMLButtonElement {
    const item = document.createElement('button')
    item.type = 'button'
    item.dataset.codexSenderItem = ''
    const titleElement = document.createElement('span')
    titleElement.textContent = title
    const detailElement = document.createElement('small')
    detailElement.textContent = detail
    item.append(titleElement, detailElement)
    return item
  }

  async function updateBinding(endpoint: string, value: object, composer: HTMLElement): Promise<void> {
    try {
      await request(endpoint, { method: 'POST', body: JSON.stringify(value) })
      picker?.remove()
      picker = undefined
      composer.querySelector<HTMLButtonElement>('[data-codex-sender-picker-button]')?.focus()
    }
    catch (error) {
      if (picker)
        picker.textContent = getErrorMessage(error)
    }
  }

  async function updateSettings(deliveryMode: 'copy' | 'paste', cwd: string, composer: HTMLElement): Promise<void> {
    try {
      await request('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ deliveryMode }),
      })
      const pickerButton = composer.querySelector<HTMLButtonElement>('[data-codex-sender-picker-button]')
      if (pickerButton)
        await openThreadPicker(new MouseEvent('click'), composer, pickerButton)
    }
    catch (error) {
      if (picker)
        picker.textContent = getErrorMessage(error)
    }
  }

  function positionPicker(button: HTMLElement): void {
    if (!picker)
      return
    const rect = button.getBoundingClientRect()
    picker.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`
    picker.style.top = `${rect.bottom + 6}px`
    picker.style.bottom = 'auto'
    picker.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 14)}px`
  }

  async function getWorkspacePath(): Promise<string> {
    const host = window as typeof window & {
      vscode?: { context?: { configuration?: () => unknown, resolveConfiguration?: () => Promise<unknown> }, process?: { platform?: string } }
    }
    const context = host.vscode?.context
    const configuration = context?.configuration?.() ?? await context?.resolveConfiguration?.()
    const workspace = (configuration as { workspace?: unknown } | undefined)?.workspace as {
      uri?: unknown
      folderUri?: unknown
      configPath?: unknown
    } | undefined
    const uri = workspace?.uri ?? workspace?.folderUri ?? workspace?.configPath
    const path = readUriPath(uri, host.vscode?.process?.platform === 'win32')

    if (!path)
      throw new Error('无法识别当前 Cursor 工作区，请先打开项目目录')

    return path
  }

  function readUriPath(value: unknown, windows: boolean): string | undefined {
    if (!value || typeof value !== 'object')
      return undefined
    const uri = value as { fsPath?: unknown, path?: unknown }
    if (typeof uri.fsPath === 'string')
      return uri.fsPath
    if (typeof uri.path !== 'string')
      return undefined
    if (!windows)
      return uri.path
    const withoutLeadingSlash = /^\/[a-z]:\//i.test(uri.path) ? uri.path.slice(1) : uri.path
    return withoutLeadingSlash.replaceAll('/', '\\')
  }

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-codex-sender-token': config.token,
        ...init.headers,
      },
    })
    const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
    if (!response.ok)
      throw new Error(body.error ?? `Bridge 请求失败：${response.status}`)
    return body
  }

  async function logEvent(level: 'debug' | 'error' | 'info' | 'warn', event: string, data: object): Promise<void> {
    try {
      await request('/api/log', {
        method: 'POST',
        body: JSON.stringify({ level, event, data }),
      })
    }
    catch {
      // Logging must never prevent the prompt handoff or mask its real error.
    }
  }

  function setButtonState(button: HTMLButtonElement, state: 'error' | 'sending' | 'success', title: string): void {
    button.dataset.codexSenderState = state
    button.title = title
    button.disabled = state === 'sending'
    if (state !== 'sending')
      setTimeout(() => { button.disabled = false }, 500)
  }

  function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
