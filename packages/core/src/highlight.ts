import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { Construct, State } from 'micromark-util-types'
import type { Plugin } from 'unified'

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    manuslipHighlight: 'manuslipHighlight'
    manuslipHighlightMarker: 'manuslipHighlightMarker'
    manuslipHighlightData: 'manuslipHighlightData'
  }
}

const highlight: Construct = {
  name: 'manuslipHighlight',
  previous: (code) => code !== 61,
  tokenize(effects, ok, nok) {
    let escaped = false
    let last = 0
    let ticks = 0
    let run = 0
    return start
    function start(code: number | null) {
      effects.enter('manuslipHighlight')
      effects.enter('manuslipHighlightMarker')
      effects.consume(code)
      return second
    }
    function second(code: number | null) {
      if (code !== 61) return nok(code)
      effects.consume(code)
      effects.exit('manuslipHighlightMarker')
      return first
    }
    function first(code: number | null) {
      if (code === null || code <= 32 || code === 61) return nok(code)
      effects.enter('manuslipHighlightData', { contentType: 'text' })
      return body(code)
    }
    function body(code: number | null): State | undefined {
      if (code === null) return nok(code)
      if (!escaped && code === 96) {
        run++
      } else if (run) {
        if (ticks === 0) ticks = run
        else if (ticks === run) ticks = 0
        run = 0
      }
      if (!escaped && !ticks && !run && code === 61 && last > 32 && last !== 61) {
        return effects.check(close, finish, consume)(code)
      }
      return consume(code)
    }
    function consume(code: number | null) {
      last = code ?? 0
      effects.consume(code)
      if (escaped) escaped = false
      else escaped = code === 92
      return body
    }
    function finish(code: number | null) {
      effects.exit('manuslipHighlightData')
      effects.enter('manuslipHighlightMarker')
      effects.consume(code)
      return end
    }
    function end(code: number | null) {
      effects.consume(code)
      effects.exit('manuslipHighlightMarker')
      effects.exit('manuslipHighlight')
      return ok
    }
  },
}
const close: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return first
    function first(code: number | null) {
      effects.consume(code)
      return second
    }
    function second(code: number | null) {
      if (code !== 61) return nok(code)
      effects.consume(code)
      return after
    }
    function after(code: number | null) {
      return code === 61 ? nok(code) : ok(code)
    }
  },
}
const fromMarkdown: FromMarkdownExtension = {
  enter: {
    manuslipHighlight(token) {
      this.enter({ type: 'emphasis', children: [], data: { hName: 'mark' } }, token)
    },
  },
  exit: {
    manuslipHighlight(token) {
      this.exit(token)
    },
  },
}

export const remarkHighlight: Plugin = function () {
  const data = this.data()
  data.micromarkExtensions ??= []
  data.fromMarkdownExtensions ??= []
  data.micromarkExtensions.push({ text: { 61: highlight } })
  data.fromMarkdownExtensions.push(fromMarkdown)
}
