import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const commands = ['install', 'doctor', 'logs', 'serve', 'uninstall', 'version']
const options = ['--cursor-path', '--port', '--no-startup', '--non-interactive', '--lines']
const deliveryModes = ['打开并复制', '打开并自动粘贴', '打开、自动粘贴并发送']

describe('readme command reference', () => {
  it.each([
    ['repository README', new URL('../../../README.md', import.meta.url)],
    ['npm package README', new URL('../README.md', import.meta.url)],
  ])('keeps the %s complete', async (_name, url) => {
    const content = await readFile(url, 'utf8')

    for (const command of commands)
      expect(content, `missing command: ${command}`).toContain(command)
    expect(content).not.toMatch(/codex-sender repair|`repair`/)
    for (const option of options)
      expect(content, `missing option: ${option}`).toContain(option)
    for (const mode of deliveryModes)
      expect(content, `missing delivery mode: ${mode}`).toContain(mode)

    expect(content).toContain('Bridge 版本')
    expect(content).toContain('自动更新')
    expect(content).toContain('Ctrl+C')
    expect(content).toContain('EPERM')
    expect(content).toContain('EADDRINUSE')
  })
})
