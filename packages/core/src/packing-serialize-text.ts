import type { PackedOutput } from './packing-output'
import type { PackedView } from './packing-view'

/** Stream JSON spelling without collecting a long/overlaid string. Decoder chunk edges
 * need not coincide with UTF-16 surrogate boundaries, so carry a trailing high surrogate.
 */
function* pieces(view: PackedView): Generator<Uint8Array | undefined> {
  const encoder = new TextEncoder()
  let pending = ''
  for (const text of view.textSteps()) {
    if (text === undefined) {
      yield undefined
      continue
    }
    let value = pending + text
    pending = ''
    const last = value.charCodeAt(value.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      pending = value.slice(-1)
      value = value.slice(0, -1)
    }
    yield encoder.encode(JSON.stringify(value).slice(1, -1))
  }
  if (pending) yield encoder.encode(JSON.stringify(pending).slice(1, -1))
}

export function* serializePackedText(view: PackedView, output: PackedOutput): Generator<void> {
  let bytes = 2
  for (const piece of pieces(view)) {
    bytes += piece?.length ?? 0
    if (bytes > output.limit - output.length)
      throw new Error('Packed serialization exceeds byte limit')
    yield
  }
  output.uint(bytes)
  if (!output.writing) {
    output.skip(bytes)
    return
  }
  output.byte(34)
  for (const piece of pieces(view)) {
    if (piece) output.bytes(piece)
    yield
  }
  output.byte(34)
}
