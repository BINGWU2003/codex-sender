import { readFile } from 'node:fs/promises'

export async function readPackageVersion(moduleUrl = import.meta.url): Promise<string> {
  const packageUrl = new URL('../package.json', moduleUrl)
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8')) as { version?: unknown }
  if (typeof packageJson.version !== 'string' || !packageJson.version)
    throw new Error(`无法从 ${packageUrl.pathname} 读取 CLI 版本`)
  return packageJson.version
}
