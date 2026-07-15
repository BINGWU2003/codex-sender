import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import { readPackageVersion } from '../src/package-info.js'

describe('package metadata', () => {
  it('uses the package.json version as the CLI version', async () => {
    await expect(readPackageVersion()).resolves.toBe(packageJson.version)
  })
})
