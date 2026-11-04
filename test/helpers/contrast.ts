/** Computed styles can serialize color-mix() as normalized CSS Color 4 sRGB. */
export function contrast(foreground: string, background: string): number {
  const luminance = (color: string): number => {
    const normalized = /^color\(srgb\s/.test(color)
    if (!normalized && !/^rgba?\(/.test(color))
      throw new Error(`Unsupported contrast color: ${color}`)
    const values = color.match(/[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)?.slice(0, 3)
    if (values?.length !== 3) throw new Error(`Invalid contrast color: ${color}`)
    const channels = values.map((value) => {
      const channel = Math.max(0, Math.min(1, Number(value) / (normalized ? 1 : 255)))
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return (channels[0] || 0) * 0.2126 + (channels[1] || 0) * 0.7152 + (channels[2] || 0) * 0.0722
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b)
  return ((values[1] || 0) + 0.05) / ((values[0] || 0) + 0.05)
}
