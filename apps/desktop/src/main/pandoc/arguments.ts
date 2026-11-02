import { type PandocOptions, parsePandocOptions } from '../../shared/pandoc-contracts'

/** No caller-supplied flags, filters, templates, engines or defaults. */
export function pandocArguments(input: PandocOptions, language = 'en'): string[] {
  const options = parsePandocOptions(input)
  return [
    '--from=html',
    `--to=${options.format === 'epub' ? 'epub3' : options.format}`,
    '--standalone',
    '--sandbox',
    '--data-dir=.',
    '--output=-',
    ...(/^zh(?:-|$)/i.test(language)
      ? ['--metadata=toc-title:目录']
      : /^en(?:-|$)/i.test(language)
        ? ['--metadata=toc-title:Contents']
        : []),
    ...(options.profile === 'numbered' ? ['--number-sections', '--toc'] : []),
    '+RTS',
    '-M512M',
    '-RTS',
  ]
}
export function pandocExtension(options: PandocOptions): string {
  return options.format === 'latex' ? 'zip' : options.format
}
