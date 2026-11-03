export const spellingChannel = 'manuslip:spelling-correction'

export interface SpellingCorrection {
  word: string
  replacement: string
}

function spellingText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
  )
}

export function parseSpellingCorrection(value: unknown): SpellingCorrection {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !('word' in value) ||
    !('replacement' in value) ||
    !spellingText(value.word) ||
    !spellingText(value.replacement)
  )
    throw new Error('Invalid spelling correction')
  return { word: value.word, replacement: value.replacement }
}
