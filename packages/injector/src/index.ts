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
      [data-codex-sender-group] { display: inline-flex; align-items: center; gap: 2px; margin-right: 4px; }
      [data-codex-sender-button] { min-width: 28px; padding: 0 7px; font-weight: 600; }
      [data-codex-sender-picker-button] { min-width: 20px; padding: 0 4px; }
      [data-codex-sender-state="sending"] { opacity: .65; }
      [data-codex-sender-state="success"] { color: var(--vscode-testing-iconPassed, #4caf50) !important; }
      [data-codex-sender-state="error"] { color: var(--vscode-testing-iconFailed, #f44336) !important; }
      [data-codex-sender-popover] { position: fixed; z-index: 100000; width: 340px; max-height: 420px; overflow: auto; padding: 8px; color: var(--vscode-foreground); background: var(--vscode-menu-background, #252526); border: 1px solid var(--vscode-menu-border, #454545); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35); font: 12px var(--vscode-font-family); }
      [data-codex-sender-item] { display: block; width: 100%; padding: 8px; color: inherit; background: transparent; border: 0; border-radius: 4px; text-align: left; cursor: pointer; }
      [data-codex-sender-item]:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
      [data-codex-sender-item] small { display: block; margin-top: 3px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      [data-codex-sender-heading] { padding: 6px 8px; opacity: .7; }
    `
    document.head.append(style)
  }

  function mountButtons(): void {
    for (const cursorSendButton of document.querySelectorAll<HTMLButtonElement>('button[aria-label="Send message"]')) {
      const composer = findComposer(cursorSendButton)
      const editor = composer?.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]')
      const parent = cursorSendButton.parentElement

      if (!composer || !editor || !parent || parent.querySelector(`:scope > [${markerAttribute}]`))
        continue

      const group = document.createElement('span')
      group.setAttribute(markerAttribute, config.version)
      group.dataset.codexSenderGroup = ''

      const sendButton = createToolbarButton(cursorSendButton, 'Codex', 'Send to Codex')
      sendButton.dataset.codexSenderButton = ''
      sendButton.addEventListener('click', event => void sendToCodex(event, composer, sendButton))

      const pickerButton = createToolbarButton(cursorSendButton, '⌄', '选择 Codex 任务')
      pickerButton.dataset.codexSenderPickerButton = ''
      pickerButton.addEventListener('click', event => void openThreadPicker(event, composer, pickerButton))

      group.append(sendButton, pickerButton)
      parent.insertBefore(group, cursorSendButton)
    }
  }

  function findComposer(button: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = button

    for (let depth = 0; current && depth < 10; depth++, current = current.parentElement) {
      if (current.matches('.composer-input-wrapper, .composer-input-container'))
        return current
      if (current.querySelector('.ProseMirror[contenteditable="true"]'))
        return current
    }

    return null
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
    const editor = composer.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]')
    // `innerText` preserves the visual line breaks entered in ProseMirror.
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    const text = editor?.innerText.trim() ?? ''

    if (!text) {
      setButtonState(button, 'error', 'Cursor 输入框为空')
      return
    }

    try {
      setButtonState(button, 'sending', '正在发送到 Codex…')
      const cwd = await getWorkspacePath()
      const job = await request('/api/send', {
        method: 'POST',
        body: JSON.stringify({ cwd, text }),
      }) as { jobId: string }
      setButtonState(button, 'success', `已加入发送队列：${job.jobId}`)
      void watchJob(job.jobId, button)
    }
    catch (error) {
      setButtonState(button, 'error', getErrorMessage(error))
    }
  }

  async function watchJob(jobId: string, button: HTMLButtonElement): Promise<void> {
    for (let attempt = 0; attempt < 180; attempt++) {
      await delay(1000)

      try {
        const job = await request(`/api/jobs/${encodeURIComponent(jobId)}`) as { status: string, error?: string, threadId?: string }

        if (job.status === 'completed') {
          setButtonState(button, 'success', `已发送到任务 ${job.threadId ?? ''}`.trim())
          return
        }
        if (job.status === 'failed') {
          setButtonState(button, 'error', job.error ?? '发送失败')
          return
        }
      }
      catch (error) {
        setButtonState(button, 'error', getErrorMessage(error))
        return
      }
    }

    setButtonState(button, 'error', '等待 Codex 发送结果超时')
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
      const result = await request(`/api/threads?cwd=${encodeURIComponent(cwd)}`) as { data: Array<{ id: string, name: string | null, preview: string, cwd: string, source: unknown, updatedAt: number }> }
      renderThreadPicker(result.data, cwd, composer)
    }
    catch (error) {
      picker.textContent = getErrorMessage(error)
    }
  }

  function renderThreadPicker(threads: Array<{ id: string, name: string | null, preview: string, cwd: string, source: unknown, updatedAt: number }>, cwd: string, composer: HTMLElement): void {
    if (!picker)
      return

    picker.replaceChildren()
    const heading = document.createElement('div')
    heading.dataset.codexSenderHeading = ''
    heading.textContent = '当前项目的 Codex 任务'
    picker.append(heading)

    const create = createPickerItem('＋ 新建 Codex 任务', cwd)
    create.addEventListener('click', () => void updateBinding('/api/unbind', { cwd }, composer))
    picker.append(create)

    for (const thread of threads) {
      const title = thread.name?.trim() || thread.preview.trim().split(/\r?\n/, 1)[0] || '未命名任务'
      const detail = `${thread.cwd} · ${new Date(thread.updatedAt * 1000).toLocaleString()}`
      const item = createPickerItem(title, detail)
      item.addEventListener('click', () => void updateBinding('/api/bind', {
        cwd,
        threadId: thread.id,
        title,
      }, composer))
      picker.append(item)
    }

    if (threads.length === 0) {
      const empty = document.createElement('div')
      empty.dataset.codexSenderHeading = ''
      empty.textContent = '没有找到历史任务'
      picker.append(empty)
    }
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

  function positionPicker(button: HTMLElement): void {
    if (!picker)
      return
    const rect = button.getBoundingClientRect()
    picker.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`
    picker.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 6)}px`
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

  function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
  }
}
