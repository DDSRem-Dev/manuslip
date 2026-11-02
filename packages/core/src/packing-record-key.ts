/** Source-free identity of one immutable arena record and its lazy transforms. The token
 * has no backlink to its arena, revision, source or owner; this never authorizes validation.
 */
export interface PackedRecordKey {
  readonly token: object
  readonly record: number
  readonly offset: number
  readonly range: number
}
