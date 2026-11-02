export const writingSizes = [0, 14, 16, 18, 20, 22, 24, 28] as const
export const writingLeading = [0, 1.4, 1.6, 1.8, 2] as const
export const writingMeasures = [0, 640, 760, 900, 1120] as const
export interface WritingTypography {
  font: 'default' | 'serif' | 'sans' | 'mono'
  size: (typeof writingSizes)[number]
  leading: (typeof writingLeading)[number]
  measure: (typeof writingMeasures)[number]
}
export const defaultTypography: WritingTypography = {
  font: 'default',
  size: 0,
  leading: 0,
  measure: 0,
}
export const writingFonts = {
  default: '',
  serif: 'Georgia,"Manuslip CJK","Times New Roman",serif',
  sans: '"Segoe UI","Manuslip CJK",-apple-system,BlinkMacSystemFont,sans-serif',
  mono: '"Cascadia Code","SFMono-Regular",Consolas,"Manuslip CJK",monospace',
} as const
/** Values are validated typography choices; callers own the complete selector. */
export function typographyCss(typography: WritingTypography, root: string): string {
  const declarations = [
    typography.font !== 'default' ? `font-family:${writingFonts[typography.font]}` : '',
    typography.size ? `font-size:${typography.size}px` : '',
    typography.leading ? `line-height:${typography.leading}` : '',
    typography.measure ? `max-width:${typography.measure}px;width:100%;margin-inline:auto` : '',
  ].filter(Boolean)
  return declarations.length ? `${root}{${declarations.join(';')}}` : ''
}
