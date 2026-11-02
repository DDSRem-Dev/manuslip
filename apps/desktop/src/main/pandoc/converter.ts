import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportLimits } from '../../shared/export-contracts'
import { type PandocOptions, pandocLimits, parsePandocOptions } from '../../shared/pandoc-contracts'
import { FileOperationError } from '../files/errors'
import { pandocArguments } from './arguments'
import { assertPandocTool, type PandocTool } from './binary'
import { inspectPandocOutput } from './output'
import { runPandocProcess } from './process'

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
function requiredImages(html: string): Set<string> {
  const images = new Set<string>()
  let count = 0,
    total = 0
  for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)) {
    if (++count > pandocLimits.mediaFiles) throw new FileOperationError('pandoc-limit')
    const data = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      match[1] || '',
    )
    if (!data) throw new FileOperationError('export-asset')
    const bytes = Buffer.from(data[1] || '', 'base64')
    total += bytes.length
    if (!bytes.length || bytes.length > exportLimits.asset || total > exportLimits.assets)
      throw new FileOperationError('pandoc-limit')
    images.add(digest(bytes))
  }
  return images
}
async function materializeImages(
  html: string,
  directory: string,
  signal: AbortSignal,
): Promise<string> {
  const replacements = new Map<string, string>()
  for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)) {
    signal.throwIfAborted()
    const reference = match[1] || ''
    if (replacements.has(reference)) continue
    const data = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(reference)
    if (!data) throw new FileOperationError('export-asset')
    const bytes = Buffer.from(data[2] || '', 'base64'),
      name = `${digest(bytes)}.${data[1] === 'jpeg' ? 'jpg' : data[1]}`
    await mkdir(join(directory, 'media'), { recursive: true, mode: 0o700 })
    const relative = `media/${name}`
    if (![...replacements.values()].includes(relative))
      await writeFile(join(directory, relative), bytes, { flag: 'wx', mode: 0o600 })
    replacements.set(reference, relative)
  }
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]*)"/gi,
    (_match, prefix: string, reference: string) => `${prefix}${replacements.get(reference)}"`,
  )
}
/** Own temporary files until the child has closed; publish only a validated complete result. */
export async function convertWithPandoc(
  tool: PandocTool,
  input: string,
  options: PandocOptions,
  signal: AbortSignal,
  inspect: typeof inspectPandocOutput = inspectPandocOutput,
): Promise<Buffer> {
  parsePandocOptions(options)
  const bytes = Buffer.from(input)
  if (bytes.length > pandocLimits.input) throw new FileOperationError('pandoc-limit')
  const images = requiredImages(input)
  signal.throwIfAborted()
  await assertPandocTool(tool, signal)
  const directory = await mkdtemp(join(tmpdir(), 'manuslip-pandoc-export-'))
  try {
    const prepared =
      options.format === 'latex'
        ? Buffer.from(await materializeImages(input, directory, signal))
        : bytes
    const result = await runPandocProcess(
      tool.path,
      pandocArguments(options, /<html lang="([A-Za-z0-9-]+)"/.exec(input)?.[1]),
      prepared,
      directory,
      signal,
      { output: pandocLimits.output, deadline: pandocLimits.totalMs, translationFallback: true },
    )
    signal.throwIfAborted()
    const output = await inspect(directory, options.format, result, images, signal)
    await assertPandocTool(tool, signal)
    signal.throwIfAborted()
    return output
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}
