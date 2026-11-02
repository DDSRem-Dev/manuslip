import { spawn } from 'node:child_process'
import type { SearchRequest } from '../../shared/search-contracts'
import { searchLimits } from '../../shared/search-contracts'
import { FileOperationError } from '../files/errors'

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
    let pending = Buffer.alloc(0),
      bytes = 0,
      truncated = false,
      killed = false,
      failed = false
    const stop = (): void => {
      killed = true
      child.kill()
    }
    const truncate = (): void => {
      truncated = true
      stop()
    }
    const timer = setTimeout(truncate, searchLimits.deadline)
    const consume = (record: Buffer): boolean => {
      try {
        return accept(record)
      } catch {
        failed = true
        stop()
        return true
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
      pending = Buffer.concat([pending, chunk])
      const delimiter = request.mode === 'filename' ? 0 : 10
      let end = pending.indexOf(delimiter)
      while (end !== -1) {
        if (end > searchLimits.record || !consume(pending.subarray(0, end))) {
          truncate()
          return
        }
        if (killed) return
        pending = pending.subarray(end + 1)
        end = pending.indexOf(delimiter)
      }
      if (pending.length > searchLimits.record) truncate()
    })
    // Error output is deliberately not retained or exposed as it may contain private paths.
    child.stderr.on('data', () => {
      failed = true
    })
    child.on('error', () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      reject(new FileOperationError('search-binary'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      if (!killed && pending.length && !consume(pending)) truncated = true
      resolve({ truncated, failed: failed || (!killed && code !== 0 && code !== 1) })
    })
  })
}
