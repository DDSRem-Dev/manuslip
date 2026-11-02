import { ChildProcess, spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { FileOperationError } from '../../../../src/main/files/errors'
import { pandocArguments } from '../../../../src/main/pandoc/arguments'
import { runPandocProcess } from '../../../../src/main/pandoc/process'
import { pandocLimits } from '../../../../src/shared/pandoc-contracts'

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))
function setup(
  limits: { output: number; deadline: number; translationFallback?: boolean } = {
    output: 128,
    deadline: 1000,
  },
) {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  })
  vi.mocked(spawn).mockReturnValue(child)
  const controller = new AbortController()
  const promise = runPandocProcess(
    '/selected/pandoc',
    pandocArguments({ format: 'docx', profile: 'document' }),
    Buffer.from('private source 中文'),
    '/owned/tmp',
    controller.signal,
    limits,
  )
  return { child, controller, promise }
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('spawns fixed arrays without a shell, excludes ambient user configuration, and joins completed output', async () => {
  const { child, promise } = setup()
  expect(spawn).toHaveBeenCalledWith(
    '/selected/pandoc',
    expect.arrayContaining(['--sandbox', '--data-dir=.', '--output=-']),
    expect.objectContaining({ cwd: '/owned/tmp', shell: false, windowsHide: true }),
  )
  const options = vi.mocked(spawn).mock.calls[0]?.[2]
  expect(options?.env).not.toHaveProperty('HOME')
  expect(options?.env).not.toHaveProperty('PANDOC_LUA_PATH')
  child.stdout.write(Buffer.from('first'))
  child.stdout.write(Buffer.from(' second'))
  child.emit('close', 0)
  expect(await promise).toEqual(Buffer.from('first second'))
  expect(child.kill).not.toHaveBeenCalled()
})
it.each(['abort', 'timeout', 'output', 'stderr', 'pipe', 'spawn'] as const)(
  'retains its charge until close after %s and discards partial/private bytes',
  async (reason) => {
    vi.useFakeTimers()
    const { child, controller, promise } = setup()
    const settled = vi.fn()
    const observed = promise.then(
      (value) => {
        settled()
        return value
      },
      (error) => {
        settled()
        return error
      },
    )
    child.stdout.write('partial')
    if (reason === 'abort') controller.abort(new FileOperationError('export-cancelled'))
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(1001)
    if (reason === 'output') child.stdout.write(Buffer.alloc(129))
    if (reason === 'stderr') child.stderr.write(Buffer.alloc(pandocLimits.stderr + 1, 'p'))
    if (reason === 'pipe') child.stdin.emit('error', new Error('private source path'))
    if (reason === 'spawn') child.emit('error', new Error('private executable path'))
    await Promise.resolve()
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    expect(settled).not.toHaveBeenCalled()
    child.stdout.write('late result')
    child.emit('close', 0)
    const error = await observed
    expect(error).toBeInstanceOf(FileOperationError)
    expect(String(error)).not.toContain('private')
    expect(vi.getTimerCount()).toBe(0)
  },
)
it.each([0, 1])('rejects empty or failed output on exit %s', async (code) => {
  const { child, promise } = setup()
  if (code) child.stdout.write('plausible but failed')
  child.emit('close', code)
  await expect(promise).rejects.toMatchObject({ code: 'pandoc-failed' })
})
it.each([true, false])(
  'accepts only an explicit bounded translation fallback policy: %s',
  async (allow) => {
    const { child, promise } = setup({ output: 128, deadline: 1000, translationFallback: allow })
    child.stdout.write('complete result')
    child.stderr.write('[WARNING] Could not load trans')
    child.stderr.write(
      'lations for zh-CN\r\n  translations/zh.yaml\r\n[WARNING] The term Abstract has no translation defined.\r\n',
    )
    child.emit('close', 0)
    if (allow) expect(await promise).toEqual(Buffer.from('complete result'))
    else await expect(promise).rejects.toMatchObject({ code: 'pandoc-failed' })
  },
)
it('rejects every unrelated warning even beside an allowed language fallback', async () => {
  const { child, promise } = setup({ output: 128, deadline: 1000, translationFallback: true })
  child.stdout.write('complete result')
  child.stderr.write(
    '[WARNING] Could not load translations for zh-CN\n  translations/zh.yaml\n[WARNING] The term Abstract has no translation defined.\n[WARNING] Could not fetch resource private-file.png\n',
  )
  child.emit('close', 0)
  await expect(promise).rejects.toMatchObject({ code: 'pandoc-failed' })
  expect(pandocArguments({ format: 'epub', profile: 'numbered' }, 'zh-CN')).toContain(
    '--metadata=toc-title:目录',
  )
})
it('rejects cancelled and over-limit input before spawning', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    runPandocProcess('/tool', [], Buffer.alloc(0), '/tmp', controller.signal),
  ).rejects.toMatchObject({ code: 'export-cancelled' })
  await expect(
    runPandocProcess(
      '/tool',
      [],
      Buffer.alloc(pandocLimits.input + 1),
      '/tmp',
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'pandoc-limit' })
  expect(spawn).not.toHaveBeenCalled()
})
it('keeps formats and numbered profiles fixed, including the explicit LaTeX media bundle', () => {
  expect(pandocArguments({ format: 'epub', profile: 'numbered' })).toEqual(
    expect.arrayContaining(['--to=epub3', '--number-sections', '--toc']),
  )
  expect(pandocArguments({ format: 'latex', profile: 'document' })).toContain('--to=latex')
  expect(pandocArguments({ format: 'latex', profile: 'document' })).not.toContain(
    '--extract-media=media',
  )
  expect(() =>
    pandocArguments({ format: '--filter=unsafe', profile: 'document' } as never),
  ).toThrow()
})
