import { ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { runSearchProcess } from '../../../../src/main/search/process'
import { searchLimits } from '../../../../src/shared/search-contracts'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))

function setup(
  mode: 'filename' | 'text' = 'text',
  accept = vi.fn<(record: Buffer) => boolean>(() => true),
  onSpawn?: (abort: AbortController) => void,
) {
  const child = Object.assign(new ChildProcess(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  })
  const abort = new AbortController()
  vi.mocked(spawn).mockImplementation(() => {
    onSpawn?.(abort)
    return child
  })
  const promise = runSearchProcess(
    'vendored-binary',
    'selected-folder',
    { id: randomUUID(), rootId: randomUUID(), query: '--pre=anything', mode, matchCase: false },
    abort.signal,
    accept,
  )
  return { child, abort, promise, accept }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('spawns without a shell and joins split records without retaining error text', async () => {
  const { child, accept, promise } = setup()
  expect(spawn).toHaveBeenCalledWith(
    'vendored-binary',
    expect.arrayContaining(['--fixed-strings', '--', '--pre=anything', '.']),
    expect.objectContaining({ cwd: 'selected-folder', shell: false, windowsHide: true }),
  )
  child.stdout.write(Buffer.from('fir'))
  child.stdout.write(Buffer.from('st\nsecond\nlast'))
  child.stderr.write('a private path that must not be retained')
  child.emit('close', 2)
  expect(accept.mock.calls.map(([record]) => String(record))).toEqual(['first', 'second', 'last'])
  expect(await promise).toEqual({ failed: true, truncated: false })
})

it('splits filenames on NUL, including filenames containing newlines', async () => {
  const { child, accept, promise } = setup('filename')
  child.stdout.write(Buffer.from('chapter\nname.md\0another.txt\0'))
  child.emit('close', 0)
  expect(accept.mock.calls.map(([record]) => String(record))).toEqual([
    'chapter\nname.md',
    'another.txt',
  ])
  expect(await promise).toEqual({ failed: false, truncated: false })
})

it('kills cancelled work and resolves only when the process closes', async () => {
  const { child, abort, promise, accept } = setup()
  let finished = false
  void promise.then(() => {
    finished = true
  })
  abort.abort()
  expect(child.kill).toHaveBeenCalledOnce()
  child.stdout.write(Buffer.from('late\n'))
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(accept).not.toHaveBeenCalled()
  child.emit('close', null)
  expect(await promise).toEqual({ failed: false, truncated: false })
})

it.each(['deadline', 'record', 'output', 'results'] as const)(
  'kills work at the %s limit and reports truncation',
  async (limit) => {
    vi.useFakeTimers()
    const { child, promise } = setup(
      'text',
      vi.fn(() => limit !== 'results'),
    )
    if (limit === 'deadline') await vi.advanceTimersByTimeAsync(searchLimits.deadline)
    else if (limit === 'record') child.stdout.write(Buffer.alloc(searchLimits.record + 1, 65))
    else if (limit === 'output') child.stdout.write(Buffer.alloc(searchLimits.output + 1, 65))
    else child.stdout.write(Buffer.from('result\n'))
    expect(child.kill).toHaveBeenCalledOnce()
    child.emit('close', null)
    expect(await promise).toEqual({ failed: false, truncated: true })
    expect(vi.getTimerCount()).toBe(0)
  },
)

it('turns record-consumer failures into a controlled failed search', async () => {
  const { child, promise } = setup(
    'text',
    vi.fn(() => {
      throw new Error('private')
    }),
  )
  expect(() => child.stdout.write(Buffer.from('record\n'))).not.toThrow()
  expect(child.kill).toHaveBeenCalledOnce()
  child.emit('close', null)
  expect(await promise).toEqual({ failed: true, truncated: false })
})

it('keeps failed work charged until close without retaining native error details', async () => {
  const { child, promise } = setup()
  let settled = false
  const result = promise.catch((error: unknown) => {
    settled = true
    return error
  })
  child.emit('error', new Error('ENOENT private binary location'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  child.emit('close', -1)
  expect(await result).toMatchObject({ code: 'search-binary' })
})

it.each(['stdout', 'stderr'] as const)(
  'handles %s pipe failures and waits for close',
  async (pipe) => {
    const { child, promise, accept } = setup()
    let settled = false
    void promise.then(() => {
      settled = true
    })
    expect(() => child[pipe].emit('error', new Error('private pipe failure'))).not.toThrow()
    child.stdout.write(Buffer.from('late\n'))
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(accept).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledOnce()
    child.emit('close', null)
    expect(await promise).toEqual({ failed: true, truncated: false })
  },
)

it('catches cancellation during spawn and kills the child only once', async () => {
  const { child, promise, accept } = setup(
    'text',
    vi.fn(() => true),
    (abort) => abort.abort(),
  )
  child.stdout.write(Buffer.from('late\n'))
  expect(child.kill).toHaveBeenCalledOnce()
  expect(accept).not.toHaveBeenCalled()
  child.emit('close', null)
  expect(await promise).toEqual({ failed: false, truncated: false })
})

it('does not report a deadline truncation while cancelled work is waiting for close', async () => {
  vi.useFakeTimers()
  const { child, abort, promise } = setup()
  abort.abort()
  await vi.advanceTimersByTimeAsync(searchLimits.deadline)
  child.emit('close', null)
  expect(await promise).toEqual({ failed: false, truncated: false })
  expect(child.kill).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('stops immediately when the consumer cancels during a record', async () => {
  const accept = vi.fn(() => {
    abort.abort()
    return false
  })
  const { child, abort, promise } = setup('text', accept)
  child.stdout.write(Buffer.from('first\nsecond\n'))
  expect(accept).toHaveBeenCalledOnce()
  expect(child.kill).toHaveBeenCalledOnce()
  child.emit('close', null)
  expect(await promise).toEqual({ failed: false, truncated: false })
})
