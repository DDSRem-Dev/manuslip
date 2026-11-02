/** Fresh transport ownership token, independent of hashes, source text and request counters. */
export function newPackedToken(): string {
  return crypto.randomUUID()
}
export function packedToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    throw new Error('Invalid packed ownership token')
  return value
}
