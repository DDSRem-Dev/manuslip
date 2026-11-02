/** Independently admitted native data used by a DOM or asynchronous renderer consumer.
 * The caller transfers one lease to renderWidget; each pending job retains its own.
 */
export interface WidgetBorrow {
  retain(): WidgetBorrow
  release(): void
}
