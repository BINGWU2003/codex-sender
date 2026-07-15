export interface InjectionConfig {
  port: number
  token: string
  version: string
}

export interface PickerPlacementInput {
  anchorBottom: number
  anchorRight: number
  anchorTop: number
  desiredHeight: number
  desiredWidth: number
  gap: number
  margin: number
  viewportHeight: number
  viewportWidth: number
}

export interface PickerPlacement {
  height: number
  left: number
  placement: 'bottom' | 'top'
  top: number
  width: number
}

export function calculatePickerPlacement(input: PickerPlacementInput): PickerPlacement {
  const maximumViewportHeight = Math.max(0, input.viewportHeight - input.margin * 2)
  const maximumViewportWidth = Math.max(0, input.viewportWidth - input.margin * 2)
  const desiredHeight = Math.min(input.desiredHeight, maximumViewportHeight)
  const heightBelow = Math.max(0, input.viewportHeight - input.margin - input.anchorBottom - input.gap)
  const heightAbove = Math.max(0, input.anchorTop - input.gap - input.margin)
  const placement = heightBelow >= desiredHeight || heightBelow >= heightAbove ? 'bottom' : 'top'
  const availableHeight = placement === 'bottom' ? heightBelow : heightAbove
  const height = Math.min(desiredHeight, availableHeight)
  const width = Math.min(input.desiredWidth, maximumViewportWidth)
  const maximumLeft = Math.max(input.margin, input.viewportWidth - input.margin - width)
  const left = Math.min(Math.max(input.anchorRight - width, input.margin), maximumLeft)
  const rawTop = placement === 'bottom'
    ? input.anchorBottom + input.gap
    : input.anchorTop - input.gap - height
  const maximumTop = Math.max(input.margin, input.viewportHeight - input.margin - height)
  const top = Math.min(Math.max(rawTop, input.margin), maximumTop)

  return { height, left, placement, top, width }
}

export function createInjectionScript(config: InjectionConfig): string {
  return `;(${injectedMain.toString()})(${JSON.stringify(config)}, ${calculatePickerPlacement.toString()});\n`
}

function injectedMain(config: InjectionConfig, calculatePlacement: typeof calculatePickerPlacement): void {
  const markerAttribute = 'data-codex-sender'
  const editorSelector = '.aislash-editor-input[contenteditable="true"]'
  const modePickerSelector = '.composer-unified-dropdown[data-mode]'
  const apiBase = `http://127.0.0.1:${config.port}`
  let picker: HTMLElement | undefined
  let pickerPositionFrame: number | undefined
  let pickerTrigger: HTMLButtonElement | undefined

  addStyles()
  mountButtons()
  new MutationObserver(mountButtons).observe(document.body, { childList: true, subtree: true })
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  document.addEventListener('keydown', handleDocumentKeyDown, true)
  document.addEventListener('scroll', handleDocumentScroll, true)
  window.addEventListener('resize', schedulePickerPosition)

  function addStyles(): void {
    if (document.querySelector('style[data-codex-sender-style]'))
      return

    const style = document.createElement('style')
    style.dataset.codexSenderStyle = config.version
    style.textContent = `
      [data-codex-sender-group] { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 2px; margin-right: 4px; }
      [data-codex-sender-button], [data-codex-sender-picker-button] { box-sizing: border-box; width: auto !important; height: 24px; border: 0; border-radius: 6px; cursor: pointer; }
      [data-codex-sender-button] { min-width: 48px !important; padding: 0 7px !important; color: var(--vscode-button-foreground, #fff) !important; background: var(--vscode-button-background, #0e639c) !important; font-weight: 600; }
      [data-codex-sender-picker-button] { display: inline-flex; width: 24px !important; min-width: 24px !important; padding: 0 !important; align-items: center; justify-content: center; color: var(--vscode-foreground) !important; background: transparent !important; }
      [data-codex-sender-picker-button] svg { display: block; width: 14px; height: 14px; pointer-events: none; }
      [data-codex-sender-button]:hover { background: var(--vscode-button-hoverBackground, #1177bb) !important; }
      [data-codex-sender-picker-button]:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)) !important; }
      [data-codex-sender-state="sending"] { opacity: .65; }
      [data-codex-sender-state="success"] { color: var(--vscode-testing-iconPassed, #4caf50) !important; }
      [data-codex-sender-state="error"] { color: var(--vscode-testing-iconFailed, #f44336) !important; }
      [data-codex-sender-popover] { position: fixed; z-index: 100000; box-sizing: border-box; display: flex; width: 340px; height: 420px; overflow: hidden; padding: 8px; flex-direction: column; color: var(--vscode-foreground); background: var(--vscode-menu-background, #252526); border: 1px solid var(--vscode-menu-border, #454545); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35); font: 12px var(--vscode-font-family); }
      [data-codex-sender-view-header] { display: flex; min-height: 32px; padding: 0 4px 6px; flex: 0 0 auto; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--vscode-menu-separatorBackground, #454545); }
      [data-codex-sender-view-title] { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      [data-codex-sender-view-switch], [data-codex-sender-new-task] { padding: 4px 7px; color: var(--vscode-textLink-foreground, #3794ff); background: transparent; border: 0; border-radius: 4px; cursor: pointer; }
      [data-codex-sender-view-switch]:hover, [data-codex-sender-new-task]:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
      [data-codex-sender-task-view], [data-codex-sender-settings-view] { min-height: 0; flex: 1 1 auto; }
      [data-codex-sender-task-view] { display: flex; flex-direction: column; }
      [data-codex-sender-settings-view] { overflow-y: auto; overscroll-behavior: contain; }
      [data-codex-sender-task-view][hidden], [data-codex-sender-settings-view][hidden] { display: none !important; }
      [data-codex-sender-task-toolbar] { display: flex; min-height: 38px; padding: 4px 4px 4px 8px; flex: 0 0 auto; align-items: center; gap: 8px; }
      [data-codex-sender-current-task] { min-width: 0; overflow: hidden; flex: 1 1 auto; opacity: .75; text-overflow: ellipsis; white-space: nowrap; }
      [data-codex-sender-thread-list] { min-height: 0; overflow-y: auto; flex: 1 1 auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
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
      const modePicker = findModePicker(editor)
      const parent = modePicker?.parentElement

      if (!modePicker || !parent || parent.querySelector(`[${markerAttribute}]`))
        continue

      const group = document.createElement('span')
      group.setAttribute(markerAttribute, config.version)
      group.dataset.codexSenderGroup = ''

      const sendButton = createToolbarButton('Codex', '交接到 Codex App')
      sendButton.dataset.codexSenderButton = ''
      sendButton.addEventListener('click', event => void sendToCodex(event, editor, sendButton))

      const pickerButton = createToolbarButton('', '选择 Codex 任务')
      pickerButton.dataset.codexSenderPickerButton = ''
      pickerButton.append(createChevronDownIcon())
      pickerButton.addEventListener('click', event => void openThreadPicker(event, pickerButton))

      group.append(sendButton, pickerButton)
      modePicker.insertAdjacentElement('afterend', group)
    }
  }

  function findModePicker(editor: HTMLElement): HTMLElement | undefined {
    for (let container = editor.parentElement; container && container !== document.body; container = container.parentElement) {
      const editors = container.querySelectorAll(editorSelector)
      const modePickers = container.querySelectorAll<HTMLElement>(modePickerSelector)
      if (editors.length === 1 && editors[0] === editor && modePickers.length === 1)
        return modePickers[0]
    }
    return undefined
  }

  function createToolbarButton(label: string, title: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.title = title
    button.setAttribute('aria-label', title)
    return button
  }

  function createChevronDownIcon(): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg'
    const icon = document.createElementNS(namespace, 'svg')
    icon.setAttribute('viewBox', '0 0 16 16')
    icon.setAttribute('aria-hidden', 'true')
    icon.setAttribute('focusable', 'false')

    const path = document.createElementNS(namespace, 'path')
    path.setAttribute('d', 'M4 6.5 8 10l4-3.5')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.5')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    icon.append(path)
    return icon
  }

  async function sendToCodex(event: Event, editor: HTMLElement, button: HTMLButtonElement): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    let restoreEditorState: ((restoreSelection?: boolean) => void) | undefined

    try {
      await ensureBridgeVersion()
      setButtonState(button, 'sending', '正在读取 Cursor 输入框…')
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
      }) as { sourceCleared: boolean, text: string, warning?: string }
      restoreEditorState(!copyResult.sourceCleared)
      restoreEditorState = undefined

      const cwd = await getWorkspacePath()
      const result = await request('/api/send', {
        method: 'POST',
        body: JSON.stringify({ cwd, text: copyResult.text }),
      }) as { message: string, warning?: string }
      const notices = [result.message]
      if (copyResult.sourceCleared)
        notices.push('Cursor 输入框已清空')
      if (copyResult.warning)
        notices.push(copyResult.warning)
      if (result.warning)
        notices.push(result.warning)
      setButtonState(button, 'success', notices.join('；'))
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
    restore: (restoreSelection?: boolean) => void
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

    const restore = (restoreSelection = true): void => {
      if (restoreSelection && selection) {
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

  async function openThreadPicker(event: MouseEvent, button: HTMLButtonElement): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    closePicker()

    picker = document.createElement('div')
    pickerTrigger = button
    picker.dataset.codexSenderPopover = ''
    picker.textContent = '正在加载 Codex 历史任务…'
    document.body.append(picker)
    positionPicker(button)

    try {
      await ensureBridgeVersion()
      const cwd = await getWorkspacePath()
      const result = await request(`/api/threads?cwd=${encodeURIComponent(cwd)}`) as {
        data: Array<{ id: string, name: string | null, preview: string, cwd: string, source: unknown, updatedAt: number }>
        binding?: { activeThreadId: string, title: string }
        settings: {
          clearCursorPromptAfterHandoff: boolean
          deliveryMode: 'copy' | 'paste' | 'paste-and-send'
        }
      }
      renderThreadPicker(result, cwd)
    }
    catch (error) {
      if (picker) {
        picker.textContent = getErrorMessage(error)
        schedulePickerPosition()
      }
    }
  }

  function renderThreadPicker(result: {
    data: Array<{ id: string, name: string | null, preview: string, cwd: string, source: unknown, updatedAt: number }>
    binding?: { activeThreadId: string, title: string }
    settings: {
      clearCursorPromptAfterHandoff: boolean
      deliveryMode: 'copy' | 'paste' | 'paste-and-send'
    }
  }, cwd: string): void {
    if (!picker)
      return

    picker.replaceChildren()

    const viewHeader = document.createElement('div')
    viewHeader.dataset.codexSenderViewHeader = ''
    const viewTitle = document.createElement('span')
    viewTitle.dataset.codexSenderViewTitle = ''
    const viewSwitch = document.createElement('button')
    viewSwitch.type = 'button'
    viewSwitch.dataset.codexSenderViewSwitch = ''
    viewHeader.append(viewTitle, viewSwitch)
    picker.append(viewHeader)

    const taskView = document.createElement('div')
    taskView.dataset.codexSenderTaskView = ''
    picker.append(taskView)

    const taskToolbar = document.createElement('div')
    taskToolbar.dataset.codexSenderTaskToolbar = ''
    const currentTask = document.createElement('span')
    currentTask.dataset.codexSenderCurrentTask = ''
    currentTask.textContent = result.binding ? `当前：${result.binding.title}` : '当前：新建 Codex 任务'
    currentTask.title = currentTask.textContent
    const create = document.createElement('button')
    create.type = 'button'
    create.dataset.codexSenderNewTask = ''
    create.textContent = result.binding ? '＋ 新建' : '✓ 新建'
    create.addEventListener('click', () => void updateBinding('/api/unbind', { cwd }))
    taskToolbar.append(currentTask, create)
    taskView.append(taskToolbar)

    const threadList = document.createElement('div')
    threadList.dataset.codexSenderThreadList = ''
    taskView.append(threadList)

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
      }))
      threadList.append(item)
    }

    if (result.data.length === 0) {
      const empty = document.createElement('div')
      empty.dataset.codexSenderHeading = ''
      empty.textContent = '没有找到历史任务'
      threadList.append(empty)
    }

    const settingsView = document.createElement('div')
    settingsView.dataset.codexSenderSettingsView = ''
    picker.append(settingsView)

    const modeHeading = document.createElement('div')
    modeHeading.dataset.codexSenderHeading = ''
    modeHeading.textContent = '提示词交接方式'
    settingsView.append(modeHeading)

    const copyMode = createPickerItem(`${result.settings.deliveryMode === 'copy' ? '✓ ' : ''}打开并复制（推荐）`, '打开任务后由你按 Ctrl+V，再确认发送')
    const pasteMode = createPickerItem(`${result.settings.deliveryMode === 'paste' ? '✓ ' : ''}打开并自动粘贴（实验）`, '使用 Windows 辅助功能定位输入框；仍由你按 Enter')
    const pasteAndSendMode = createPickerItem(`${result.settings.deliveryMode === 'paste-and-send' ? '✓ ' : ''}打开、自动粘贴并发送（实验）`, '校验粘贴内容后自动按 Enter 发送')
    settingsView.append(copyMode, pasteMode, pasteAndSendMode)

    const deliveryModes = [
      { item: copyMode, label: '打开并复制（推荐）', mode: 'copy' as const },
      { item: pasteMode, label: '打开并自动粘贴（实验）', mode: 'paste' as const },
      { item: pasteAndSendMode, label: '打开、自动粘贴并发送（实验）', mode: 'paste-and-send' as const },
    ]
    const refreshDeliveryModes = (): void => {
      for (const entry of deliveryModes) {
        const active = result.settings.deliveryMode === entry.mode
        entry.item.dataset.active = String(active)
        const title = entry.item.firstElementChild
        if (title)
          title.textContent = `${active ? '✓ ' : ''}${entry.label}`
      }
    }
    const selectDeliveryMode = async (mode: 'copy' | 'paste' | 'paste-and-send', item: HTMLButtonElement): Promise<void> => {
      item.disabled = true
      const saved = await updateSettings({ deliveryMode: mode })
      item.disabled = false
      if (!saved)
        return
      result.settings.deliveryMode = mode
      refreshDeliveryModes()
    }
    for (const entry of deliveryModes)
      entry.item.addEventListener('click', () => void selectDeliveryMode(entry.mode, entry.item))
    refreshDeliveryModes()

    const deliveryDivider = document.createElement('div')
    deliveryDivider.dataset.codexSenderDivider = ''
    settingsView.append(deliveryDivider)

    const postHandoffHeading = document.createElement('div')
    postHandoffHeading.dataset.codexSenderHeading = ''
    postHandoffHeading.textContent = '交接后处理'
    settingsView.append(postHandoffHeading)

    const clearCursorPrompt = createPickerItem(
      `${result.settings.clearCursorPromptAfterHandoff ? '✓ ' : ''}成功交接后清空 Cursor 输入框`,
      '清空前再次核对完整提示词，确认一致后按 Ctrl+A、Delete',
    )
    settingsView.append(clearCursorPrompt)
    const refreshClearCursorPrompt = (): void => {
      const active = result.settings.clearCursorPromptAfterHandoff
      clearCursorPrompt.dataset.active = String(active)
      const title = clearCursorPrompt.firstElementChild
      if (title)
        title.textContent = `${active ? '✓ ' : ''}成功交接后清空 Cursor 输入框`
    }
    clearCursorPrompt.addEventListener('click', () => void (async () => {
      const enabled = !result.settings.clearCursorPromptAfterHandoff
      clearCursorPrompt.disabled = true
      const saved = await updateSettings({ clearCursorPromptAfterHandoff: enabled })
      clearCursorPrompt.disabled = false
      if (!saved)
        return
      result.settings.clearCursorPromptAfterHandoff = enabled
      refreshClearCursorPrompt()
    })())
    refreshClearCursorPrompt()

    const showView = (view: 'settings' | 'tasks'): void => {
      const showSettings = view === 'settings'
      taskView.hidden = showSettings
      settingsView.hidden = !showSettings
      viewTitle.textContent = showSettings ? '交接设置' : 'Codex 任务'
      viewSwitch.textContent = showSettings ? '返回任务' : '交接设置'
      picker!.dataset.codexSenderActiveView = view
      schedulePickerPosition()
    }
    viewSwitch.addEventListener('click', () => {
      showView(taskView.hidden ? 'tasks' : 'settings')
    })
    showView('tasks')

    schedulePickerPosition()
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

  async function updateBinding(endpoint: string, value: object): Promise<void> {
    try {
      await request(endpoint, { method: 'POST', body: JSON.stringify(value) })
      const trigger = pickerTrigger
      closePicker()
      trigger?.focus()
    }
    catch (error) {
      if (picker)
        picker.textContent = getErrorMessage(error)
    }
  }

  async function updateSettings(settings: {
    clearCursorPromptAfterHandoff?: boolean
    deliveryMode?: 'copy' | 'paste' | 'paste-and-send'
  }): Promise<boolean> {
    try {
      await request('/api/settings', {
        method: 'POST',
        body: JSON.stringify(settings),
      })
      return true
    }
    catch (error) {
      if (picker) {
        picker.textContent = getErrorMessage(error)
        schedulePickerPosition()
      }
      return false
    }
  }

  function handleDocumentPointerDown(event: PointerEvent): void {
    const target = event.target
    if (!picker || !(target instanceof Node) || picker.contains(target))
      return
    if (target instanceof Element && target.closest('[data-codex-sender-picker-button]'))
      return
    closePicker()
  }

  function handleDocumentKeyDown(event: KeyboardEvent): void {
    if (!picker || event.key !== 'Escape')
      return
    event.preventDefault()
    event.stopPropagation()
    closePicker(true)
  }

  function handleDocumentScroll(event: Event): void {
    const target = event.target
    if (picker && target instanceof Node && picker.contains(target))
      return
    schedulePickerPosition()
  }

  function closePicker(returnFocus = false): void {
    const trigger = pickerTrigger
    if (pickerPositionFrame !== undefined) {
      cancelAnimationFrame(pickerPositionFrame)
      pickerPositionFrame = undefined
    }
    picker?.remove()
    picker = undefined
    pickerTrigger = undefined
    if (returnFocus)
      trigger?.focus()
  }

  function positionPicker(button: HTMLElement): void {
    if (!picker)
      return
    const rect = button.getBoundingClientRect()
    const layout = calculatePlacement({
      anchorBottom: rect.bottom,
      anchorRight: rect.right,
      anchorTop: rect.top,
      desiredHeight: 420,
      desiredWidth: 340,
      gap: 6,
      margin: 8,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    })
    picker.dataset.codexSenderPlacement = layout.placement
    picker.style.left = `${layout.left}px`
    picker.style.top = `${layout.top}px`
    picker.style.width = `${layout.width}px`
    picker.style.height = `${layout.height}px`
    picker.style.right = 'auto'
    picker.style.bottom = 'auto'
  }

  function schedulePickerPosition(): void {
    if (!picker || !pickerTrigger || pickerPositionFrame !== undefined)
      return
    pickerPositionFrame = requestAnimationFrame(() => {
      pickerPositionFrame = undefined
      if (pickerTrigger)
        positionPicker(pickerTrigger)
    })
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

  async function ensureBridgeVersion(): Promise<void> {
    const health = await request('/health') as { version?: unknown }
    if (health.version !== config.version) {
      const bridgeVersion = typeof health.version === 'string' ? health.version : '未知'
      throw new Error(`Bridge 版本 ${bridgeVersion} 与注入脚本 ${config.version} 不一致，请重启 Bridge 后重试`)
    }
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
