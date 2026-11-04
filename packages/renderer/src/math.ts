import { semanticLimits, utf8Bytes } from '@manuslip/core'
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js'
import '@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js'
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import '@mathjax/src/js/input/tex/braket/BraketConfiguration.js'
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js'
import '@mathjax/src/js/input/tex/cases/CasesConfiguration.js'
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js'
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js'
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js'
import '@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js'
import '@mathjax/src/js/input/tex/upgreek/UpgreekConfiguration.js'
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js'
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js'
import '@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js'
import '@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js'
import { mathjax } from '@mathjax/src/js/mathjax.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { markMathSource } from './math-source'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

/** Run in a terminable worker. No browser DOM, network loaders, HTML extensions or shared macros. */
export function renderMath(tex: string, display: boolean): string {
  if (utf8Bytes(tex) > semanticLimits.texBytes) throw new Error('math-limit')
  const input = new TeX({
    packages: [
      'base',
      'ams',
      'newcommand',
      'mhchem',
      'amscd',
      'boldsymbol',
      'braket',
      'cancel',
      'cases',
      'mathtools',
      'physics',
      'textmacros',
      'unicode',
      'upgreek',
      'color',
      'bbox',
      'enclose',
      'extpfeil',
    ],
    maxBuffer: semanticLimits.texBytes,
    maxMacros: 1000,
    formatError: (_jax: unknown, error: Error) => {
      throw error
    },
  })
  input.postFilters.add(() => markMathSource(input.parseOptions.root, tex))
  // A worker/export result is one standalone image. MathJax otherwise splits
  // inline formulas at operators into multiple SVG siblings.
  const output = new SVG({
    fontData: MathJaxTexFont,
    fontCache: 'none',
    linebreaks: { inline: false },
  })
  const document = mathjax.document('', { InputJax: input, OutputJax: output })
  const node = document.convert(tex, { display, em: 16, ex: 8, containerWidth: 960 })
  const svg = adaptor.tags(node, 'svg')[0]
  if (!svg) throw new Error('math-render')
  const result = adaptor.outerHTML(svg)
  if (utf8Bytes(result) > semanticLimits.messageBytes) throw new Error('math-limit')
  return result
}
