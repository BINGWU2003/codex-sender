import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  platform: 'node',
  deps: {
    alwaysBundle: [/^@codex-sender\//],
    neverBundle: ['vscode'],
  },
  outExtensions: () => ({ js: '.cjs' }),
})
