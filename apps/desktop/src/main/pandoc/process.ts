import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pandocLimits } from '../../shared/pandoc-contracts'
import { FileOperationError } from '../files/errors'

interface ProcessLimits {
  output: number
  deadline: number
  translationFallback?: boolean
}
function translationWarningsOnly(stderr: string): boolean {
  // Pandoc has no built-in translations for some valid document languages, including Chinese.
  const missing =
    /\[WARNING\] Could not load translations for [A-Za-z0-9-]+\r?\n[ \t]+translations\/[A-Za-z0-9_-]+\.yaml\r?\n/g
  const terms =
    /\[WARNING\] The term (?:Abstract|Appendix|Bibliography|Cc|Chapter|Contents|Encl|Figure|Glossary|Index|Listing|ListOfFigures|ListOfTables|Page|Part|Preface|Proof|References|See|SeeAlso|Table|To) has no translation defined\.\r?\n/g
  return missing.test(stderr) && stderr.replace(missing, '').replace(terms, '') === ''
}
/** Keep the caller charged until close, including error, abort and pipe failure. */
export async function runPandocProcess(
  binary: string,
  args: readonly string[],
  input: Buffer,
  directory: string,
  signal: AbortSignal,
  limits: ProcessLimits = { output: pandocLimits.output, deadline: pandocLimits.totalMs },
): Promise<Buffer> {
  const cancellation = (): FileOperationError =>
    signal.reason instanceof FileOperationError
      ? signal.reason
      : new FileOperationError('export-cancelled')
  if (signal.aborted) throw cancellation()
  if (
    input.length > pandocLimits.input ||
    !Number.isSafeInteger(limits.output) ||
    limits.output <= 0 ||
    limits.output > pandocLimits.output ||
    !Number.isSafeInteger(limits.deadline) ||
    limits.deadline <= 0 ||
    limits.deadline > pandocLimits.totalMs
  )
    throw new FileOperationError('pandoc-limit')
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: directory,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH:
          process.platform === 'win32'
            ? join(process.env.SystemRoot || 'C:/Windows', 'System32')
            : '/usr/bin:/bin',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        TMPDIR: directory,
        TEMP: directory,
        TMP: directory,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
    })
    let failure: FileOperationError | undefined,
      outputBytes = 0,
      stderrBytes = 0
    const chunks: Buffer[] = [],
      diagnostics: Buffer[] = []
    const stop = (error: FileOperationError): void => {
      if (failure) return
      failure = error
      chunks.length = 0
      diagnostics.length = 0
      try {
        child.kill('SIGKILL')
      } catch {
        /* close still owns settlement */
      }
    }
    const abort = (): void => stop(cancellation())
    const timer = setTimeout(() => stop(new FileOperationError('export-timeout')), limits.deadline)
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return
      outputBytes += chunk.length
      if (outputBytes > limits.output) stop(new FileOperationError('pandoc-limit'))
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (failure) return
      stderrBytes += chunk.length
      if (stderrBytes > pandocLimits.stderr) stop(new FileOperationError('pandoc-limit'))
      else diagnostics.push(chunk)
    })
    child.on('error', () => stop(new FileOperationError('pandoc-tool')))
    child.stdin.on('error', () => stop(new FileOperationError('pandoc-failed')))
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else if (signal.aborted) reject(cancellation())
      else if (
        code !== 0 ||
        !outputBytes ||
        (stderrBytes &&
          !(
            limits.translationFallback &&
            translationWarningsOnly(Buffer.concat(diagnostics, stderrBytes).toString('utf8'))
          ))
      )
        reject(new FileOperationError('pandoc-failed'))
      else resolve(Buffer.concat(chunks, outputBytes))
    })
    child.stdin.end(input)
    if (signal.aborted) abort()
  })
}
