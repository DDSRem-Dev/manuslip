// Internal provenance, not wire input. Tokens deliberately retain neither index nor source.
const indexes = new WeakMap<object, object>()
const fragments = new WeakMap<object, object>()

export function rememberFragment<T extends object>(index: object, fragment: T): T {
  let token = indexes.get(index)
  if (!token) {
    token = Object.freeze({})
    indexes.set(index, token)
  }
  fragments.set(fragment, token)
  return fragment
}

export function assertFragmentProof(index: object, fragment: object): void {
  const token = indexes.get(index)
  if (!token || fragments.get(fragment) !== token)
    throw new Error('Semantic dependency fragment provenance mismatch; full parse required')
}
