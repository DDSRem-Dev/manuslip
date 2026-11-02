import { StateEffect, StateField, type Text, type Transaction } from '@codemirror/state'
import { utf8Bytes } from '@manuslip/core/text'

export const maxDocumentBytes = 50 * 1024 * 1024
export const limitRejected = StateEffect.define<null>()
/** Count rope pieces without flattening the document. A pair can straddle piece boundaries. */
export function textByteLength(text: Text, from = 0, to = text.length): number {
  let bytes = 0,
    previousHigh = false
  for (const piece of text.iterRange(from, to)) {
    if (!piece.length) continue
    const first = piece.charCodeAt(0)
    bytes += utf8Bytes(piece)
    if (previousHigh && first >= 0xdc00 && first <= 0xdfff) bytes -= 2
    const last = piece.charCodeAt(piece.length - 1)
    previousHigh = last >= 0xd800 && last <= 0xdbff
  }
  return bytes
}

export function changedByteLength(transaction: Transaction, initial: number): number {
  const ranges: { from: number; to: number }[] = []
  transaction.changes.iterChangedRanges((from, to) => {
    const start = Math.max(0, from - 1)
    const end = Math.min(transaction.startState.doc.length, to + 1)
    const previous = ranges[ranges.length - 1]
    if (previous && start <= previous.to) previous.to = Math.max(previous.to, end)
    else ranges.push({ from: start, to: end })
  })
  let length = initial
  for (const range of ranges) {
    const from = transaction.changes.mapPos(range.from, -1)
    const to = transaction.changes.mapPos(range.to, 1)
    length +=
      textByteLength(transaction.newDoc, from, to) -
      textByteLength(transaction.startState.doc, range.from, range.to)
  }
  return length
}

export const documentBytes = StateField.define<number>({
  create: (state) => textByteLength(state.doc),
  update: (length, transaction) =>
    transaction.docChanged ? changedByteLength(transaction, length) : length,
})
