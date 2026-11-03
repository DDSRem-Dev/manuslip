/** Keep Typora's common image sizing without admitting arbitrary document CSS. */
export function imageSizingStyle(source: string): string {
  if (source.length > 2048) return ''
  const declarations = new Map<string, string>()
  for (const declaration of source.split(';')) {
    const match = /^\s*(width|height|zoom)\s*:\s*(.*?)\s*$/i.exec(declaration)
    if (!match) continue
    const name = match[1]?.toLowerCase()
    const value = match[2]?.toLowerCase() ?? ''
    if (name === 'zoom') {
      const zoom = /^(\d+(?:\.\d+)?|\.\d+)(%)?$/.exec(value)
      if (!zoom) continue
      const scale = Number(zoom[1]) / (zoom[2] ? 100 : 1)
      if (scale >= 0.05 && scale <= 10) declarations.set(name, String(scale))
    } else if (name === 'width' || name === 'height') {
      if (value === 'auto') declarations.set(name, value)
      else {
        const size = /^(\d+(?:\.\d+)?|\.\d+)(px|%)?$/.exec(value)
        if (!size) continue
        const amount = Number(size[1])
        if (amount > 0 && amount <= (size[2] === '%' ? 100 : 32768))
          declarations.set(name, `${amount}${size[2] || 'px'}`)
      }
    }
  }
  return [...declarations].map(([name, value]) => `${name}: ${value}`).join('; ')
}
