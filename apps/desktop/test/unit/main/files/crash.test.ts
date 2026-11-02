import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('process interruption at replacement boundaries', () => {
  let directory: string
  let executable: string
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'manuslip-crash-'))
    const source = join(directory, 'crash-entry.ts')
    executable = join(directory, 'crash-entry.mjs')
    const implementation = fileURLToPath(
      new URL('../../../../src/main/files/disk.ts', import.meta.url),
    ).replaceAll('\\', '/')
    await writeFile(
      source,
      `
      import { rename } from 'node:fs/promises'
      import { atomicWrite, readDisk } from ${JSON.stringify(implementation)}
      const [phase, path] = process.argv.slice(2)
      const disk = await readDisk(path)
      await atomicWrite(path, Buffer.from('complete replacement'), disk.fingerprint, {
        beforeReplace: async () => { if (phase === 'before') process.exit(91) },
        replace: async (source, destination) => { await rename(source, destination); process.exit(92) },
      })
    `,
    )
    const output = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        ssr: true,
        write: false,
        minify: false,
        rollupOptions: { input: source, output: { format: 'es' } },
      },
    })
    if (Array.isArray(output) || !('output' in output)) throw new Error('Unexpected fixture build')
    const chunk = output.output.find((item) => item.type === 'chunk' && item.isEntry)
    if (chunk?.type !== 'chunk') throw new Error('Missing crash fixture')
    await writeFile(executable, chunk.code)
  })
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 })
  })

  it.each(['before', 'after'] as const)(
    'retains a complete file when the process exits %s replacement',
    async (phase) => {
      const path = join(directory, `${phase}.md`)
      await writeFile(path, 'original complete file')
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, [executable, phase, path], {
          windowsHide: true,
          stdio: 'pipe',
        })
        child.once('error', reject)
        child.once('exit', resolve)
      })
      expect(code).toBe(phase === 'before' ? 91 : 92)
      expect(await readFile(path, 'utf8')).toBe(
        phase === 'before' ? 'original complete file' : 'complete replacement',
      )
    },
  )
})
