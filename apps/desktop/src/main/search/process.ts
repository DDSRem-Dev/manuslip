import { spawn } from 'node:child_process'
import type { SearchRequest } from '../../shared/search-contracts'
import { searchLimits } from '../../shared/search-contracts'
import { FileOperationError } from '../files/errors'
import { SearchRecordStream } from './stream'

export function searchArguments(request: SearchRequest): string[] {
  const args = [
    '--no-config',
    '--no-follow',
    '--no-require-git',
    '--no-ignore-parent',
    '--no-ignore-global',
    '--threads',
    '2',
    '--max-filesize',
    '50M',
    '--type-add',
    'manuslip:*.{[mM][dD],[mM][aA][rR][kK][dD][oO][wW][nN],[mM][dD][oO][wW][nN],[tT][xX][tT]}',
    '--type',
    'manuslip',
    '--glob',
    '!**/.git/**',
    '--glob',
    '!**/node_modules/**',
    '--glob',
    '!**/.*',
  ]
  return request.mode === 'filename'
    ? [...args, '--files', '--null', '.']
    : [
        ...args,
        '--json',
        '--fixed-strings',
        '--encoding',
        'auto',
        request.matchCase ? '--case-sensitive' : '--ignore-case',
        '--',
        request.query,
        '.',
      ]
}

/** Stream records with byte/deadline bounds; resolve only after the child has closed. */
export async function runSearchProcess(
  binary: string,
  root: string,
  request: SearchRequest,
  signal: AbortSignal,
  accept: (record: Buffer) => boolean,
): Promise<{ truncated: boolean; failed: boolean }> {
  if (signal.aborted) return { truncated: false, failed: false }
  return new Promise((resolve, reject) => {
    const child = spawn(binary, searchArguments(request), {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RIPGREP_CONFIG_PATH: '' },
    })
    const records = new SearchRecordStream(request.mode === 'filename' ? 0 : 10)
    let bytes = 0,
      truncated = false,
      killed = false,
      failed = false
    let failure: FileOperationError | undefined
    const stop = (): void => {
      if (killed) return
      killed = true
      records.clear()
      child.kill('SIGKILL')
    }
    const truncate = (): void => {
      if (killed) return
      truncated = true
      stop()
    }
    const timer = setTimeout(truncate, searchLimits.deadline)
    const fail = (): void => {
      failed = true
      stop()
    }
    const consume = (record: Buffer): boolean => {
      try {
        const keep = accept(record)
        return keep && !killed
      } catch {
        fail()
        return false
      }
    }
    signal.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      if (killed) return
      bytes += chunk.length
      if (bytes > searchLimits.output) {
        truncate()
        return
      }
      if (!records.push(chunk, consume) && !killed) truncate()
    })
    child.stdout.on('error', fail)
    // Error output is deliberately not retained or exposed as it may contain private paths.
    child.stderr.on('data', () => {
      failed = true
    })
    child.stderr.on('error', fail)
    child.on('error', () => {
      failure = new FileOperationError('search-binary')
      stop()
    })
    child.on('close', (code) => {
      if (!killed && !records.finish(consume) && !killed) truncated = true
      records.clear()
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      if (failure) reject(failure)
      else resolve({ truncated, failed: failed || (!killed && code !== 0 && code !== 1) })
    })
    if (signal.aborted) stop()
  })
}
