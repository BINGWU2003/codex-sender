import type { DeliveryMode } from '@codex-sender/core'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'

const maximumDeepLinkLength = 16_000

export interface CodexAppDeliveryRequest {
  cwd: string
  text: string
  threadId?: string
  mode: DeliveryMode
}

export interface CodexAppDeliveryResult {
  mode: DeliveryMode
  requestedMode: DeliveryMode
  threadId?: string
  copied: true
  prefilled: boolean
  pasted: boolean
  submitted: boolean
  message: string
  warning?: string
}

export interface CodexAppSystem {
  clearFocusedCursorPrompt: (expectedText: string) => Promise<void>
  copyFocusedCursorPrompt: () => Promise<string>
  copyAndOpen: (url: string, text: string) => Promise<void>
  pasteIntoComposer: (text: string, submit?: boolean) => Promise<void>
  readClipboardText: () => Promise<string>
}

export interface CodexAppLauncherOptions {
  platform?: NodeJS.Platform
  system?: CodexAppSystem
}

export class CodexAppLauncher {
  private readonly platform: NodeJS.Platform
  private readonly system: CodexAppSystem

  constructor(options: CodexAppLauncherOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.system = options.system ?? new WindowsCodexAppSystem()
  }

  async readClipboardText(): Promise<string> {
    if (this.platform !== 'win32')
      throw new Error('读取系统剪贴板目前只支持 Windows')
    return await this.system.readClipboardText()
  }

  async copyFocusedCursorPrompt(): Promise<string> {
    if (this.platform !== 'win32')
      throw new Error('Cursor 原生复制目前只支持 Windows')
    return await this.system.copyFocusedCursorPrompt()
  }

  async clearFocusedCursorPrompt(expectedText: string): Promise<void> {
    if (this.platform !== 'win32')
      throw new Error('清空 Cursor 输入框目前只支持 Windows')
    await this.system.clearFocusedCursorPrompt(expectedText)
  }

  async deliver(request: CodexAppDeliveryRequest): Promise<CodexAppDeliveryResult> {
    if (this.platform !== 'win32')
      throw new Error('Codex App 交接目前只支持 Windows')

    const newTaskUrl = request.threadId ? undefined : createNewTaskUrl(request.cwd, request.text)
    const prefilled = Boolean(newTaskUrl && newTaskUrl.length <= maximumDeepLinkLength)
    const url = request.threadId
      ? createThreadUrl(request.threadId)
      : prefilled ? newTaskUrl! : createNewTaskUrl(request.cwd)

    await this.system.copyAndOpen(url, request.text)

    if (prefilled && request.mode !== 'paste-and-send') {
      return {
        requestedMode: request.mode,
        mode: request.mode,
        threadId: request.threadId,
        copied: true,
        prefilled: true,
        pasted: false,
        submitted: false,
        message: '已在 Codex App 新任务中预填提示词，请确认后按 Enter',
      }
    }

    if (request.mode === 'paste' || request.mode === 'paste-and-send') {
      const shouldSubmit = request.mode === 'paste-and-send'
      try {
        await this.system.pasteIntoComposer(request.text, shouldSubmit)
        return {
          requestedMode: request.mode,
          mode: request.mode,
          threadId: request.threadId,
          copied: true,
          prefilled,
          pasted: !prefilled,
          submitted: shouldSubmit,
          message: shouldSubmit
            ? `已在 Codex App ${prefilled ? '预填' : '粘贴'}提示词并自动发送`
            : '已打开 Codex App 并粘贴提示词，请确认后按 Enter',
        }
      }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return {
          requestedMode: request.mode,
          mode: prefilled ? 'paste' : 'copy',
          threadId: request.threadId,
          copied: true,
          prefilled,
          pasted: false,
          submitted: false,
          message: prefilled
            ? '已在 Codex App 新任务中预填提示词，请确认后按 Enter'
            : '已打开 Codex App 并复制提示词，请按 Ctrl+V 后发送',
          warning: `${shouldSubmit ? '自动粘贴并发送' : '自动粘贴'}未完成：${reason}`,
        }
      }
    }

    return {
      requestedMode: request.mode,
      mode: 'copy',
      threadId: request.threadId,
      copied: true,
      prefilled: false,
      pasted: false,
      submitted: false,
      message: '已打开 Codex App 并复制提示词，请按 Ctrl+V 后发送',
    }
  }
}

export function createThreadUrl(threadId: string): string {
  if (!/^[\w.-]{1,128}$/.test(threadId))
    throw new Error('Codex 任务 ID 格式无效')
  return `codex://threads/${encodeURIComponent(threadId)}`
}

export function createNewTaskUrl(cwd: string, prompt?: string): string {
  const parameters: string[] = []
  if (prompt !== undefined)
    parameters.push(`prompt=${encodeURIComponent(prompt.toWellFormed())}`)
  parameters.push(`path=${encodeURIComponent(cwd.toWellFormed())}`)
  return `codex://threads/new?${parameters.join('&')}`
}

class WindowsCodexAppSystem implements CodexAppSystem {
  async clearFocusedCursorPrompt(expectedText: string): Promise<void> {
    // eslint-disable-next-line ts/no-use-before-define
    await runPowerShell(clearFocusedCursorPromptScript, expectedText)
  }

  async copyFocusedCursorPrompt(): Promise<string> {
    // eslint-disable-next-line ts/no-use-before-define
    const encoded = (await runPowerShell(copyFocusedCursorPromptScript)).trim()
    if (!encoded)
      throw new Error('Cursor 原生复制未返回文本')
    return Buffer.from(encoded, 'base64').toString('utf8')
  }

  async copyAndOpen(url: string, text: string): Promise<void> {
    // Scripts are constants kept below the launcher implementation for readability.
    // eslint-disable-next-line ts/no-use-before-define
    await runPowerShell(copyAndOpenScript, text, { CODEX_SENDER_URL: url })
  }

  async pasteIntoComposer(text: string, submit = false): Promise<void> {
    // eslint-disable-next-line ts/no-use-before-define
    await runPowerShell(pasteIntoComposerScript, text, { CODEX_SENDER_SUBMIT: submit ? '1' : '0' })
  }

  async readClipboardText(): Promise<string> {
    // eslint-disable-next-line ts/no-use-before-define
    const encoded = (await runPowerShell(readClipboardScript)).trim()
    if (!encoded)
      return ''
    return Buffer.from(encoded, 'base64').toString('utf8')
  }
}

async function runPowerShell(script: string, input = '', extraEnvironment: NodeJS.ProcessEnv = {}): Promise<string> {
  const command = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n${script}`
  const child = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], {
    env: { ...process.env, ...extraEnvironment },
    windowsHide: true,
    stdio: 'pipe',
  })

  let stderr = ''
  let stdout = ''
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${chunk.toString()}`.slice(-2_000_000)
  })
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8_192)
  })
  const exitTask = waitForExit(child)
  child.stdin.on('error', () => {})
  child.stdin.end(Buffer.from(input, 'utf8').toString('base64'))
  const code = await exitTask
  if (code !== 0)
    throw new Error(stderr.trim() || `PowerShell 退出，状态码 ${code}`)
  return stdout
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
}

const decodeInputScript = String.raw`
$encoded = [Console]::In.ReadToEnd()
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
`

const copyAndOpenScript = String.raw`
$ErrorActionPreference = 'Stop'
${decodeInputScript}
Set-Clipboard -Value $text
Start-Process -FilePath $env:CODEX_SENDER_URL
`

const readClipboardScript = String.raw`
$ErrorActionPreference = 'Stop'
$text = Get-Clipboard -Raw
if ($null -eq $text) { $text = '' }
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
`

const copyFocusedCursorPromptScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexSenderCursorNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$windowHandle = [CodexSenderCursorNative]::GetForegroundWindow()
$processId = [uint32]0
[void][CodexSenderCursorNative]::GetWindowThreadProcessId($windowHandle, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction Stop
if ($process.ProcessName -ne 'Cursor') { throw '前台窗口不是 Cursor，已停止原生复制' }
$focused = [Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused -or $focused.Current.ProcessId -ne $processId) {
  throw '键盘焦点不在 Cursor 输入框，已停止原生复制'
}

$sentinel = 'codex-sender-copy-' + [Guid]::NewGuid().ToString('N')
Set-Clipboard -Value $sentinel
[Windows.Forms.SendKeys]::SendWait('^a')
Start-Sleep -Milliseconds 75
[Windows.Forms.SendKeys]::SendWait('^c')
Start-Sleep -Milliseconds 175

if ([CodexSenderCursorNative]::GetForegroundWindow() -ne $windowHandle) {
  throw '复制期间前台窗口发生变化，已停止交接'
}
$text = Get-Clipboard -Raw
if ([String]::IsNullOrEmpty($text) -or $text -eq $sentinel) {
  throw 'Cursor 没有将提示词写入系统剪贴板'
}
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
`

const clearFocusedCursorPromptScript = String.raw`
$ErrorActionPreference = 'Stop'
${decodeInputScript}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexSenderCursorClearNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

$windowHandle = [CodexSenderCursorClearNative]::GetForegroundWindow()
$processId = [uint32]0
[void][CodexSenderCursorClearNative]::GetWindowThreadProcessId($windowHandle, [ref]$processId)
$process = Get-Process -Id $processId -ErrorAction Stop
if ($process.ProcessName -ne 'Cursor') { throw '前台窗口不是 Cursor，已保留原提示词' }
$focused = [Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused -or $focused.Current.ProcessId -ne $processId) {
  throw '键盘焦点不在 Cursor 输入框，已保留原提示词'
}

$sentinel = 'codex-sender-clear-' + [Guid]::NewGuid().ToString('N')
Set-Clipboard -Value $sentinel
[Windows.Forms.SendKeys]::SendWait('^a')
Start-Sleep -Milliseconds 75
[Windows.Forms.SendKeys]::SendWait('^c')
Start-Sleep -Milliseconds 175

if ([CodexSenderCursorClearNative]::GetForegroundWindow() -ne $windowHandle) {
  throw '清空前 Cursor 窗口焦点发生变化，已保留原提示词'
}
$actual = Get-Clipboard -Raw
if ($null -eq $actual -or -not [String]::Equals($actual, $text, [StringComparison]::Ordinal)) {
  Set-Clipboard -Value $text
  throw '当前选中内容与本次提示词不一致，已保留原提示词'
}

[Windows.Forms.SendKeys]::SendWait('{DELETE}')
Start-Sleep -Milliseconds 100
`

const pasteIntoComposerScript = String.raw`
$ErrorActionPreference = 'Stop'
${decodeInputScript}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexSenderNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
"@

function Read-ElementText($element) {
  try {
    $pattern = $element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    return $pattern.Current.Value
  } catch {}
  try {
    $pattern = $element.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern)
    return $pattern.DocumentRange.GetText(-1)
  } catch {}
  return $null
}

function Test-IsEmptyComposerText($value) {
  if ($null -eq $value -or [String]::IsNullOrWhiteSpace($value)) { return $true }
  $normalized = $value.Trim()
  return $normalized -in @(
    '要求后续变更',
    'Ask for follow-up changes'
  )
}

function Find-Composer {
  $foregroundHandle = [CodexSenderNative]::GetForegroundWindow().ToInt32()
  $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll(
    [Windows.Automation.TreeScope]::Children,
    [Windows.Automation.Condition]::TrueCondition
  )
  $best = $null
  $bestScore = -1
  $bestWindowHandle = 0
  foreach ($window in $windows) {
    try {
      $process = Get-Process -Id $window.Current.ProcessId -ErrorAction Stop
      if ($process.ProcessName -notmatch '^(ChatGPT|Codex)$') { continue }
      if ($window.Current.NativeWindowHandle -ne $foregroundHandle) { continue }
      $windowRect = $window.Current.BoundingRectangle
      $elements = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
    } catch { continue }
    foreach ($element in $elements) {
      try {
        if (-not $element.Current.IsEnabled -or -not $element.Current.IsKeyboardFocusable) { continue }
        $rect = $element.Current.BoundingRectangle
        if ($rect.IsEmpty -or $rect.Height -lt 24) { continue }
        $isProseMirror = $element.Current.ClassName -match '(^|\s)ProseMirror(\s|$)'
        $isTextControl = $element.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -or $element.Current.ControlType -eq [Windows.Automation.ControlType]::Document
        $isComposerName = $element.Current.Name -match '(message|prompt|ask|codex|输入|消息)'
        $isInComposerArea = $rect.Top -gt ($windowRect.Top + ($windowRect.Height * 0.3))
        if (-not $isProseMirror -and (-not $isTextControl -or -not $isComposerName -or -not $isInComposerArea)) { continue }
        if ($element.Current.AutomationId -eq 'RootWebArea') { continue }
        $score = 0
        if ($isProseMirror) { $score += 100 }
        if ($element.Current.ControlType -eq [Windows.Automation.ControlType]::Document) { $score += 8 }
        if ($isComposerName) { $score += 20 }
        if ($isInComposerArea) { $score += 5 }
        if ($score -gt $bestScore) {
          $bestScore = $score
          $best = $element
          $bestWindowHandle = $window.Current.NativeWindowHandle
        }
      } catch { continue }
    }
  }
  if ($null -eq $best) { return $null }
  return [PSCustomObject]@{ Element = $best; WindowHandle = $bestWindowHandle }
}

function Test-ComposerFocus($composer) {
  try {
    if ($composer.Current.HasKeyboardFocus) { return $true }
    $focused = [Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $focused -or $focused.Current.ProcessId -ne $composer.Current.ProcessId) { return $false }
    $composerRect = $composer.Current.BoundingRectangle
    $focusedRect = $focused.Current.BoundingRectangle
    if ($composerRect.IsEmpty -or $focusedRect.IsEmpty) { return $false }
    $focusedCenterX = $focusedRect.Left + ($focusedRect.Width / 2)
    $focusedCenterY = $focusedRect.Top + ($focusedRect.Height / 2)
    return $focusedCenterX -ge $composerRect.Left -and $focusedCenterX -le $composerRect.Right -and $focusedCenterY -ge $composerRect.Top -and $focusedCenterY -le $composerRect.Bottom
  } catch { return $false }
}

function Click-Composer($composer) {
  $rect = $composer.Current.BoundingRectangle
  if ($rect.IsEmpty -or $rect.Width -lt 20 -or $rect.Height -lt 20) {
    throw 'Codex 输入框没有可点击区域'
  }
  $original = New-Object 'CodexSenderNative+POINT'
  if (-not [CodexSenderNative]::GetCursorPos([ref]$original)) {
    throw '无法读取当前鼠标位置'
  }
  $x = [int]($rect.Left + ($rect.Width / 2))
  $y = [int]($rect.Top + ($rect.Height / 2))
  try {
    if (-not [CodexSenderNative]::SetCursorPos($x, $y)) { throw '无法移动鼠标到 Codex 输入框' }
    Start-Sleep -Milliseconds 50
    [CodexSenderNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [CodexSenderNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
  } finally {
    [void][CodexSenderNative]::SetCursorPos($original.X, $original.Y)
  }
}

$deadline = [DateTime]::UtcNow.AddSeconds(12)
$verified = $false
$pasteAttempts = 0
$textNormalized = $text -replace [char]13, ''
while ([DateTime]::UtcNow -lt $deadline -and -not $verified) {
  $target = Find-Composer
  if ($null -eq $target) {
    Start-Sleep -Milliseconds 200
    continue
  }
  if ([CodexSenderNative]::GetForegroundWindow().ToInt32() -ne $target.WindowHandle) {
    Start-Sleep -Milliseconds 200
    continue
  }

  $composer = $target.Element
  try {
    $existing = Read-ElementText $composer
    $existingNormalized = $existing -replace [char]13, ''
    if ($null -ne $existing -and $existingNormalized.Contains($textNormalized)) {
      $verified = $true
      break
    }
    if (-not (Test-IsEmptyComposerText $existing)) {
      throw 'Codex 输入框中已有草稿，为避免覆盖已停止自动粘贴'
    }
    $composer.SetFocus()
  } catch [System.Windows.Automation.ElementNotAvailableException] {
    Start-Sleep -Milliseconds 200
    continue
  }

  Start-Sleep -Milliseconds 100
  if ([CodexSenderNative]::GetForegroundWindow().ToInt32() -ne $target.WindowHandle) {
    throw 'Codex App 窗口焦点已变化，已停止自动粘贴'
  }
  if (-not (Test-ComposerFocus $composer)) {
    try {
      Click-Composer $composer
    } catch [System.Windows.Automation.ElementNotAvailableException] {
      Start-Sleep -Milliseconds 200
      continue
    }
  }
  if (-not (Test-ComposerFocus $composer)) {
    Start-Sleep -Milliseconds 200
    continue
  }
  [Windows.Forms.SendKeys]::SendWait('^v')
  $pasteAttempts += 1

  $verifyDeadline = [DateTime]::UtcNow.AddMilliseconds(1500)
  while ([DateTime]::UtcNow -lt $verifyDeadline) {
    try {
      $actual = Read-ElementText $composer
      $actualNormalized = $actual -replace [char]13, ''
      if ($null -ne $actual -and $actualNormalized.Contains($textNormalized)) {
        $verified = $true
        break
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] {
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $verified -and $pasteAttempts -ge 3) { break }
  if (-not $verified) { Start-Sleep -Milliseconds 200 }
}
if (-not $verified) { throw "已执行 $pasteAttempts 次粘贴，但无法从辅助功能树校验输入内容" }
if ($env:CODEX_SENDER_SUBMIT -eq '1') {
  if ([CodexSenderNative]::GetForegroundWindow().ToInt32() -ne $target.WindowHandle) {
    throw '粘贴完成后 Codex App 窗口焦点已变化，已停止自动发送'
  }
  try {
    $composer.SetFocus()
  } catch [System.Windows.Automation.ElementNotAvailableException] {
    throw 'Codex 输入框已失效，已停止自动发送'
  }
  Start-Sleep -Milliseconds 100
  if (-not (Test-ComposerFocus $composer)) {
    try {
      Click-Composer $composer
    } catch [System.Windows.Automation.ElementNotAvailableException] {
      throw 'Codex 输入框已失效，已停止自动发送'
    }
  }
  if ([CodexSenderNative]::GetForegroundWindow().ToInt32() -ne $target.WindowHandle -or -not (Test-ComposerFocus $composer)) {
    throw '无法确认 Codex 输入框焦点，已停止自动发送'
  }
  [Windows.Forms.SendKeys]::SendWait('{ENTER}')
}
`
