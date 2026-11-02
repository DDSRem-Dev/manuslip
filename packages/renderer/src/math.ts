import { semanticLimits, utf8Bytes } from '@manuslip/core'
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js'
import { mathjax } from '@mathjax/src/js/mathjax.js'
import { SVG } from '@mathjax/src/js/output/svg.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

/** Run in a terminable worker. No browser DOM, network loaders, HTML extensions or shared macros. */
export function renderMath(tex: string, display: boolean): string {
  if (utf8Bytes(tex) > semanticLimits.texBytes) throw new Error('math-limit')
  const input = new TeX({
    packages: ['base', 'ams', 'newcommand', 'mhchem'],
    maxBuffer: semanticLimits.texBytes,
    maxMacros: 1000,
    formatError: (_jax: unknown, error: Error) => {
      throw error
    },
  })
  const output = new SVG({ fontData: MathJaxTexFont, fontCache: 'none' })
  const document = mathjax.document('', { InputJax: input, OutputJax: output })
  const node = document.convert(tex, { display, em: 16, ex: 8, containerWidth: 960 })
  const svg = adaptor.tags(node, 'svg')[0]
  if (!svg) throw new Error('math-render')
  const result = adaptor.outerHTML(svg)
  if (utf8Bytes(result) > semanticLimits.messageBytes) throw new Error('math-limit')
  return result
}
