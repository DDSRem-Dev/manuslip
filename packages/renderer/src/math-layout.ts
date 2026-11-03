/** Recover MathJax's baseline from sanitized SVG geometry, without allowing CSS
 * through the sanitizer. The scroll container uses the image's bottom as its
 * baseline, so it must carry the formula's depth below the prose baseline.
 */
export function inlineMathBaseline(
  height: string | null,
  viewBox: string | null,
): string | undefined {
  const ex = /^(\d+(?:\.\d+)?)ex$/.exec(height ?? '')
  const box = viewBox?.trim().split(/\s+/).map(Number)
  const [, top, , size] = box ?? []
  const extent = Number(ex?.[1])
  if (
    !ex ||
    box?.length !== 4 ||
    !box.every(Number.isFinite) ||
    !Number.isFinite(extent) ||
    top === undefined ||
    size === undefined ||
    size <= 0
  )
    return
  const depth = ((top + size) / size) * extent
  return `${-depth}ex`
}
