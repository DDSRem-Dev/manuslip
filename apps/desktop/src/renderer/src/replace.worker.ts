import { prepareReplacements, type ReplaceInput, replaceLimits } from '@manuslip/editor/replace'

self.onmessage = (event: MessageEvent<ReplaceInput>) => {
  const input = event.data
  try {
    if (
      !Number.isSafeInteger(input?.sequence) ||
      !Array.isArray(input.lines) ||
      !input.lines.every((line) => typeof line === 'string') ||
      input.lines.reduce((length, line) => length + line.length + 1, -1) > 50 * 1024 * 1024 ||
      typeof input.wordChars !== 'string' ||
      input.wordChars.length > 1024 ||
      typeof input.query?.search !== 'string' ||
      typeof input.query.replace !== 'string' ||
      ['literal', 'caseSensitive', 'regexp', 'wholeWord'].some(
        (key) => typeof Reflect.get(input.query, key) !== 'boolean',
      )
    )
      throw new Error('replace-failed')
    if (input.query.search.length + input.query.replace.length > replaceLimits.message)
      throw new Error('replace-limit')
    self.postMessage({ sequence: input.sequence, kind: 'started' })
    const result = prepareReplacements(input)
    const payload = new TextEncoder().encode(JSON.stringify(result)).buffer
    if (payload.byteLength + 1024 > replaceLimits.message) throw new Error('replace-limit')
    self.postMessage({ sequence: input.sequence, payload }, { transfer: [payload] })
  } catch (error) {
    const code =
      error instanceof Error &&
      ['replace-limit', 'file-large', 'replace-query'].includes(error.message)
        ? error.message
        : 'replace-failed'
    self.postMessage({ sequence: input?.sequence, error: code })
  }
}
