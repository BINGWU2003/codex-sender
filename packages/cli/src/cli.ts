#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { BridgeServer, Logger, StateStore } from '@codex-sender/bridge'
import { CursorInstaller } from './cursor-installer.js'
import { registerStartup, removeStartup, startBridgeDetached } from './startup.js'

const version = '0.1.0'

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2)

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(version)
    return
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (!['doctor', 'install', 'logs', 'repair', 'serve', 'uninstall'].includes(command))
    throw new Error(`未知命令：${command}\n运行 codex-sender help 查看帮助。`)

  const cursorPath = readOption(args, '--cursor-path')
  const port = readNumberOption(args, '--port')
  const stateStore = new StateStore({ defaultPort: port })
  const installer = new CursorInstaller({
    dataDirectory: stateStore.dataDirectory,
    cursorPath,
  })

  switch (command) {
    case 'install':
    case 'repair': {
      const state = await stateStore.load()
      if (port && state.port !== port)
        await stateStore.setPort(port)
      const manifest = await installer.install({ port: state.port, token: state.token, version })
      const cliEntryPath = fileURLToPath(import.meta.url)
      if (!args.includes('--no-startup')) {
        await registerStartup(cliEntryPath)
        startBridgeDetached(cliEntryPath)
      }
      console.log(`Codex Sender 已注入 Cursor ${manifest.cursorVersion}`)
      console.log(`Cursor 目录：${manifest.paths.appRoot}`)
      console.log('请重新启动 Cursor。')
      break
    }
    case 'uninstall': {
      await installer.uninstall()
      await removeStartup()
      console.log('Codex Sender 已从 Cursor 恢复。')
      break
    }
    case 'doctor': {
      const report = await installer.doctor()
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok)
        process.exitCode = 1
      break
    }
    case 'logs': {
      const logger = new Logger({ dataDirectory: stateStore.dataDirectory })
      const lines = readPositiveIntegerOption(args, '--lines') ?? 100
      try {
        const content = await readFile(logger.logPath, 'utf8')
        console.log(content.trimEnd().split(/\r?\n/).slice(-lines).join('\n'))
      }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
          throw error
        console.log(`尚未生成日志：${logger.logPath}`)
      }
      break
    }
    case 'serve': {
      const state = await stateStore.load()
      if (port && state.port !== port)
        await stateStore.setPort(port)
      const bridge = new BridgeServer({ stateStore, version })
      const listeningPort = await bridge.start()
      console.log(`Codex Sender bridge 正在监听 127.0.0.1:${listeningPort}`)
      const stop = async (): Promise<void> => {
        await bridge.stop()
        process.exit(0)
      }
      process.once('SIGINT', () => void stop())
      process.once('SIGTERM', () => void stop())
      break
    }
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0)
    return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error(`${name} 缺少参数值`)
  return value
}

function readNumberOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name)
  if (value === undefined)
    return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error(`${name} 必须是 1-65535 之间的整数`)
  return parsed
}

function readPositiveIntegerOption(args: string[], name: string): number | undefined {
  const value = readOption(args, name)
  if (value === undefined)
    return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000)
    throw new Error(`${name} 必须是 1-10000 之间的整数`)
  return parsed
}

function printHelp(): void {
  console.log(`Codex Sender ${version}

用法：
  codex-sender install [--cursor-path PATH] [--port PORT] [--no-startup]
  codex-sender repair [--cursor-path PATH] [--port PORT] [--no-startup]
  codex-sender doctor [--cursor-path PATH]
  codex-sender logs [--lines COUNT]
  codex-sender serve [--port PORT]
  codex-sender uninstall
  codex-sender version

安装和恢复 Cursor 时必须先完全退出 Cursor。`)
}
