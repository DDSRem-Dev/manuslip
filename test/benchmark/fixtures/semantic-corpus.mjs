const MiB = 1024 * 1024
const fill = (chunk) => chunk.repeat(Math.ceil(MiB / Buffer.byteLength(chunk)))
/** Complete authoritative corpus bodies shared by application transport diagnostics. */
export const semanticCorpus = [
  [
    'prose',
    fill(
      `${'Writing leaves room for another idea. A short sentence makes the next edit easy. '.repeat(8)}\n\n`,
    ),
  ],
  [
    'single-paragraph',
    fill(
      'A long paragraph still needs responsive editing, accurate counts and current semantics. ',
    ),
  ],
  [
    'mixed-rtl',
    fill(
      `${'English writing. 中文段落。日本語の文章。 العربية نص للقراءة. עברית לקריאה. '.repeat(8)}\n\n`,
    ),
  ],
  [
    'repeated-paragraphs',
    fill('The same short paragraph appears again. Its occurrence must stay distinct.\n\n'),
  ],
  ['many-small-blocks', fill('A small paragraph. One more short sentence for the next block.\n\n')],
  [
    'nested-containers',
    `${fill(`${'> > > > > > > > Nested writing with **emphasis**, `code`, a [link][r] and enough prose to keep reading. '.repeat(3)}\n\nSeparate context.\n\n`)}\n[r]: https://example.invalid/\n`,
  ],
]
