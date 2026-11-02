const chunkUnits = 4096
const pieceLimit = 256
/** Bounded pieces, joined output and one pending input coexist. Admit before iteration. */
export const projectionChunkBufferBytes = 64 * 1024

/** Combine small serializer outputs without hiding its suspension/native-call barriers.
 * Each advance reads at most one piece or upstream progress boundary. A flush
 * contains <=4097 UTF-16 units and never separates a surrogate pair across input pieces.
 * The owner must keep the buffer and emitted output charged through the consumer's borrow.
 */
export function* bufferProjectionChunks(
  chunks: IterableIterator<string | undefined>,
): Generator<string | undefined> {
  const pieces: string[] = []
  let units = 0
  function flush(): string {
    const value = pieces.join('')
    pieces.length = 0
    units = 0
    return value
  }
  try {
    for (let value of chunks) {
      if (value === undefined) {
        yield
        continue
      }
      if (value.length > chunkUnits) throw new Error('Projection buffer input exceeds chunk limit')
      if (value.length) {
        if (units && (units + value.length > chunkUnits || pieces.length >= pieceLimit)) {
          const previous = pieces[pieces.length - 1]
          const left = previous?.charCodeAt(previous.length - 1) ?? 0
          const right = value.charCodeAt(0)
          if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) {
            pieces.push(value[0] ?? '')
            units++
            value = value.slice(1)
          }
          yield flush()
        }
        if (value.length) {
          pieces.push(value)
          units += value.length
        }
      }
      // A string was also a suspension point upstream. Preserve it even while the
      // output stays private, so separate lexical/native batches cannot combine.
      yield
    }
    if (units) yield flush()
  } finally {
    pieces.length = 0
  }
}
