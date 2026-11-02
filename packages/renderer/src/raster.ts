export const rasterLimits = {
  width: 1024,
  side: 8192,
  pixels: 16_000_000,
  jpegQuality: 92,
  slides: 200,
} as const

/** Admit device pixels before a native surface or bitmap is allocated. */
export function rasterSize(width: number, height: number, scale = 1) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(scale) ||
    width <= 0 ||
    height <= 0 ||
    scale <= 0 ||
    scale > 4
  )
    throw new Error('export-image-limit')
  const cssWidth = Math.ceil(width),
    cssHeight = Math.ceil(height),
    pixelWidth = Math.ceil(cssWidth * scale),
    pixelHeight = Math.ceil(cssHeight * scale)
  if (
    cssWidth > rasterLimits.side ||
    cssHeight > rasterLimits.side ||
    pixelWidth > rasterLimits.side ||
    pixelHeight > rasterLimits.side ||
    pixelWidth * pixelHeight > rasterLimits.pixels
  )
    throw new Error('export-image-limit')
  return { width: cssWidth, height: cssHeight, pixelWidth, pixelHeight }
}
