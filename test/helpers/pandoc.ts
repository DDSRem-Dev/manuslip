import { readFile } from 'node:fs/promises'

export const pandocPixel = new URL(
  '../../apps/desktop/test/fixtures/pandoc/images/图 & pixel.png',
  import.meta.url,
)

export function pandocTestPath(): string {
  const path = process.env.MANUSLIP_TEST_PANDOC
  if (!path)
    throw new Error('Set MANUSLIP_TEST_PANDOC to a Pandoc 3 executable before running Pandoc tests')
  return path
}

/** Keep authored examples readable while explicitly testing CRLF file preservation. */
export async function pandocFixture(
  name: 'conversion' | 'export' | 'reading' | 'references',
  newline: 'lf' | 'crlf' = 'lf',
): Promise<string> {
  const source = await readFile(
    new URL(`../../apps/desktop/test/fixtures/pandoc/${name}.md`, import.meta.url),
    'utf8',
  )
  return source.replace(/\r\n?/g, '\n').replace(/\n/g, newline === 'crlf' ? '\r\n' : '\n')
}
