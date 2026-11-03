import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { Construct, Token } from 'micromark-util-types'
import type { Plugin } from 'unified'

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    manuslipLatex: 'manuslipLatex'
    manuslipLatexData: 'manuslipLatexData'
  }
  interface Token {
    _manuslipDisplay?: boolean
  }
}

const latex: Construct = {
  name: 'manuslipLatex',
  tokenize(effects, ok, nok) {
    let token: Token
    let closing = 41
    let slash = false
    let data = false
    return start
    function start(code: number | null) {
      token = effects.enter('manuslipLatex')
      effects.consume(code)
      return open
    }
    function open(code: number | null) {
      if (code !== 40 && code !== 91) return nok(code)
      token._manuslipDisplay = code === 91
      closing = code === 91 ? 93 : 41
      effects.consume(code)
      return body
    }
    function body(code: number | null) {
      if (code === null) return nok(code)
      if (slash && code === closing) {
        effects.consume(code)
        if (data) effects.exit('manuslipLatexData')
        effects.exit('manuslipLatex')
        return ok
      }
      slash = !slash && code === 92
      if (code < 0) {
        if (data) effects.exit('manuslipLatexData')
        data = false
        effects.enter('lineEnding')
        effects.consume(code)
        effects.exit('lineEnding')
      } else {
        if (!data) effects.enter('manuslipLatexData')
        data = true
        effects.consume(code)
      }
      return body
    }
  },
}
const fromMarkdown: FromMarkdownExtension = {
  enter: {
    manuslipLatex(token) {
      const value = this.sliceSerialize(token)
        .slice(2, -2)
        .replace(/\r\n?|\n/g, '\n')
      this.enter(
        {
          type: 'inlineMath',
          value,
          data: {
            hName: 'code',
            hProperties: { className: [token._manuslipDisplay ? 'math-display' : 'math-inline'] },
            hChildren: [{ type: 'text', value }],
            manuslipDisplay: token._manuslipDisplay === true,
          },
        },
        token,
      )
      this.buffer()
    },
  },
  exit: {
    manuslipLatex(token) {
      this.resume()
      this.exit(token)
    },
  },
}

export const remarkLatexDelimiters: Plugin = function () {
  const data = this.data()
  data.micromarkExtensions ??= []
  data.fromMarkdownExtensions ??= []
  data.micromarkExtensions.push({ text: { 92: latex } })
  data.fromMarkdownExtensions.push(fromMarkdown)
}
