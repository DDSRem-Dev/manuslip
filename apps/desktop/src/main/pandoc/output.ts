import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { exportLimits } from '../../shared/export-contracts'
import { type PandocFormat, pandocLimits } from '../../shared/pandoc-contracts'
import { readDisk } from '../files/disk'
import { FileOperationError } from '../files/errors'
import { readPandocZip, writePandocZip } from './zip'

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
function assertImages(required: Set<string>, media: Iterable<Buffer>): void {
  for (const bytes of media) required.delete(digest(bytes))
  if (required.size) throw new FileOperationError('pandoc-failed')
}
async function latexBundle(
  directory: string,
  tex: Buffer,
  images: Set<string>,
  signal: AbortSignal,
): Promise<Buffer> {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(tex)
  } catch {
    throw new FileOperationError('pandoc-failed')
  }
  if (!text.includes('\\begin{document}') || text.includes('\0'))
    throw new FileOperationError('pandoc-failed')
  const files = new Map<string, Buffer>([['document.tex', tex]])
  let total = 0
  const directoryEntries = await readdir(directory, { withFileTypes: true })
  if (
    directoryEntries.some(
      (entry) => entry.name !== 'media' || !entry.isDirectory() || entry.isSymbolicLink(),
    )
  )
    throw new FileOperationError('pandoc-failed')
  if (directoryEntries.length) {
    const entries = await readdir(join(directory, 'media'), { withFileTypes: true })
    if (entries.length > pandocLimits.mediaFiles) throw new FileOperationError('pandoc-limit')
    for (const entry of entries) {
      signal.throwIfAborted()
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !/^[A-Za-z0-9_-]{1,128}\.(?:png|jpe?g|gif|webp)$/.test(entry.name)
      )
        throw new FileOperationError('pandoc-failed')
      const disk = await readDisk(join(directory, 'media', entry.name), exportLimits.asset)
      if (disk.links > 1n) throw new FileOperationError('pandoc-failed')
      total += disk.bytes.length
      if (total > exportLimits.assets) throw new FileOperationError('pandoc-limit')
      files.set(`media/${entry.name}`, disk.bytes)
      if (!text.includes(`media/${entry.name}`)) throw new FileOperationError('pandoc-failed')
    }
  }
  assertImages(
    images,
    [...files].filter(([name]) => name.startsWith('media/')).map(([, bytes]) => bytes),
  )
  files.set(
    'README.txt',
    Buffer.from(
      'Open document.tex with a Unicode-capable LaTeX editor. Keep the media folder beside it. A LaTeX installation and suitable fonts are required to compile this source.\n',
    ),
  )
  return writePandocZip(files)
}

export async function inspectPandocOutput(
  directory: string,
  format: PandocFormat,
  result: Buffer,
  images: Set<string>,
  signal: AbortSignal,
): Promise<Buffer> {
  let output: Buffer
  if (format === 'latex') output = await latexBundle(directory, result, images, signal)
  else {
    const files = readPandocZip(result)
    if (format === 'docx') {
      if (
        !files.has('[Content_Types].xml') ||
        !files.get('word/document.xml')?.includes(Buffer.from('w:document'))
      )
        throw new FileOperationError('pandoc-failed')
      assertImages(
        images,
        [...files].filter(([name]) => name.startsWith('word/media/')).map(([, bytes]) => bytes),
      )
    } else {
      if (
        files.get('mimetype')?.toString() !== 'application/epub+zip' ||
        !files.has('META-INF/container.xml') ||
        ![...files.keys()].some((name) => name.endsWith('.opf'))
      )
        throw new FileOperationError('pandoc-failed')
      assertImages(images, files.values())
    }
    output = result
  }
  signal.throwIfAborted()
  return output
}
