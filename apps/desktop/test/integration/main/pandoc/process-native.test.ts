import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { expect, it } from 'vitest'
import { runPandocProcess } from '../../../../src/main/pandoc/process'

it('streams exact UTF-8 input through a real child and reaps a timed-out child', async () => {
  const root = resolve('apps/desktop/test/integration/result')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(resolve(root, 'pandoc-process-'))
  if (!directory.startsWith(root + sep)) throw new Error('Unsafe fixture path')
  try {
    const input = Buffer.from('Captured source\r\n\r\n中文 *structure* 😀\r\n')
    const echo = [
      '--input-type=module',
      '-e',
      'for await (const bytes of process.stdin) process.stdout.write(bytes)',
    ]
    expect(
      await runPandocProcess(
        process.execPath,
        echo,
        input,
        directory,
        new AbortController().signal,
      ),
    ).toEqual(input)
    await expect(
      runPandocProcess(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        Buffer.alloc(0),
        directory,
        new AbortController().signal,
        { output: 128, deadline: 100 },
      ),
    ).rejects.toMatchObject({ code: 'export-timeout' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
