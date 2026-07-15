import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as prompts from '@clack/prompts'
import { CursorInstaller, findCursorInstallation } from './cursor-installer.js'

export type InstallFeature = 'startup'

export interface InstallWizardDefaults {
  allowStartup?: boolean
  cursorPath?: string
  port: number
  registerStartup: boolean
}

export interface InstallWizardResult {
  cursorPath: string
  port: number
  registerStartup: boolean
}

export async function runInstallWizard(defaults: InstallWizardDefaults): Promise<InstallWizardResult | undefined> {
  prompts.intro('Codex Sender 安装向导')

  const cursorPath = await prompts.text({
    message: 'Cursor 安装路径',
    placeholder: 'Cursor.exe 或 resources/app 目录',
    initialValue: defaults.cursorPath,
    validate: validateCursorPath,
  })
  if (prompts.isCancel(cursorPath))
    return cancelWizard()

  const port = await prompts.text({
    message: 'Bridge 监听端口',
    initialValue: String(defaults.port),
    validate: validatePort,
  })
  if (prompts.isCancel(port))
    return cancelWizard()

  const initialValues: InstallFeature[] = []
  if (defaults.registerStartup)
    initialValues.push('startup')

  const features = defaults.allowStartup === false
    ? []
    : await prompts.multiselect<InstallFeature>({
        message: '选择安装选项（空格切换，回车确认）',
        options: [
          {
            value: 'startup',
            label: '注册 Windows 登录自启动',
            hint: '登录 Windows 后自动运行 Bridge',
          },
        ],
        initialValues,
        required: false,
        showInstructions: true,
      })
  if (prompts.isCancel(features))
    return cancelWizard()

  const result: InstallWizardResult = {
    cursorPath: cursorPath.trim(),
    port: Number(port),
    registerStartup: features.includes('startup'),
  }
  prompts.note([
    `Cursor：${result.cursorPath}`,
    `Bridge：http://127.0.0.1:${result.port}`,
    `登录自启动：${result.registerStartup ? '是' : '否'}`,
    'Bridge：安装后自动更新并启动',
  ].join('\n'), '安装配置')

  const confirmed = await prompts.confirm({
    message: '确认修改 Cursor 安装文件？',
    initialValue: true,
  })
  if (prompts.isCancel(confirmed) || !confirmed)
    return cancelWizard()

  prompts.outro('配置已确认，开始安装')
  return result
}

export async function suggestCursorPath(explicitPath?: string, dataDirectory?: string): Promise<string | undefined> {
  if (explicitPath)
    return explicitPath

  if (dataDirectory) {
    try {
      const manifest = await new CursorInstaller({ dataDirectory }).readManifest()
      if (manifest)
        return findCursorInstallation(manifest.paths.appRoot).appRoot
    }
    catch {
      // Ignore a missing, malformed, or stale installation manifest and rediscover Cursor.
    }
  }

  try {
    const { appRoot } = findCursorInstallation()
    const executablePath = path.resolve(appRoot, '..', '..', 'Cursor.exe')
    return existsSync(executablePath) ? executablePath : appRoot
  }
  catch {
    return undefined
  }
}

export function shouldRunInstallWizard(args: string[], stdinIsTTY = Boolean(process.stdin.isTTY), stdoutIsTTY = Boolean(process.stdout.isTTY)): boolean {
  return stdinIsTTY && stdoutIsTTY && !args.includes('--non-interactive')
}

export function validatePort(value: string | undefined): string | undefined {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    return '端口必须是 1-65535 之间的整数'
  return undefined
}

function validateCursorPath(value: string | undefined): string | undefined {
  if (!value?.trim())
    return '请输入 Cursor.exe 或 resources/app 路径'
  try {
    findCursorInstallation(value.trim())
    return undefined
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function cancelWizard(): undefined {
  prompts.cancel('安装已取消，未修改 Cursor')
  return undefined
}
