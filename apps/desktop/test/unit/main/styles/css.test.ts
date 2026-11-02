import { describe, expect, it } from 'vitest'
import { compileStylesheet } from '../../../../src/main/styles/css'
import { styleLimits } from '../../../../src/shared/style-contracts'

describe('bounded content stylesheets', () => {
  const root = '[data-style-document="local"] .reading-article'
  it('scopes every branch, maps Live semantics and keeps root aliases inside content', () => {
    const css = compileStylesheet(
      '/* local */ BODY > H1, h2 { color: #406144; font-size: 28px } blockquote p { margin-block: 1em; line-height: 1.6 } :root { font-family: Georgia, serif } .markdown-body table td { padding: 4px 8px; border-color: rgb(40, 50, 60) }',
      root,
    )
    expect(css).toContain(
      `${root} > :is(h1,.cm-live-heading-1),${root} :is(h2,.cm-live-heading-2){color:#406144;--manuslip-heading-color:#406144;font-size:clamp(10px, 28px, 64px)}`,
    )
    expect(css).toContain(
      `${root} :is(blockquote,.cm-live-quote) p{margin-block:1em;line-height:1.6}`,
    )
    expect(css).toContain(`${root}{font-family:Georgia, serif}`)
    expect(css.split('\n')).toHaveLength(4)
  })
  it.each([
    '@import "https://example.invalid/style.css";',
    '@font-face { font-family: local; src: url(file:///secret) }',
    '@media screen { p { color: red } }',
    'body { --paper: red }',
    'button { color: red }',
    'html { color: red }',
    '.document-actions { color: red }',
    '* { color: red }',
    'p, button { color: red }',
    'body + button { color: red }',
    'p:has(button) { color: red }',
    '[role=button] { color: red }',
    'p::before { content: "x" }',
    'p { position: fixed }',
    'p { display: none }',
    'p { opacity: 0 }',
    'p { pointer-events: none }',
    'p { transform: scale(0) }',
    'p { color: red !important }',
    'p { background-image: url(https://example.invalid) }',
    'p { color: url(https://example.invalid) }',
    'p { color: var(--accent) }',
    'p { color: expression(alert(1)) }',
    'p { font-family: u/**/rl(https://example.invalid) }',
    'p { color: r\\65 d }',
    'p { color: red; & { color: blue } }',
    'p { font-size: 999999px }',
    'p { line-height: 100 }',
    'p { margin: -40px }',
    'p { padding: 100000em }',
    'p { color: red\0 }',
    'p { font-family: "</style><script>" }',
    '/* no rules */',
    'p { color: red',
  ])('rejects hostile, unsupported or unbounded CSS: %s', (source) => {
    expect(() => compileStylesheet(source, root)).toThrow()
  })
  it('checks input, rule, selector, declaration and output bounds', () => {
    expect(() => compileStylesheet(' '.repeat(styleLimits.input + 1), root)).toThrow()
    expect(() => compileStylesheet('p{color:red}'.repeat(styleLimits.rules + 1), root)).toThrow()
    expect(() =>
      compileStylesheet(`${'p,'.repeat(styleLimits.selectors)}p{color:red}`, root),
    ).toThrow()
    expect(() =>
      compileStylesheet(`p{${'color:red;'.repeat(styleLimits.declarations + 1)}}`, root),
    ).toThrow()
    expect(() => compileStylesheet(`${'p,'.repeat(255)}p{color:red}`, 'x'.repeat(600))).toThrow()
  })
  it('bounds tiny fonts and rejects obfuscated URL functions even in color properties', () => {
    expect(
      compileStylesheet(
        'p { font-size: 0; letter-spacing: -2px; color: color-mix(in srgb, red, blue) }',
        root,
      ),
    ).toContain('font-size:clamp(10px, 0px, 64px)')
    expect(() => compileStylesheet('p { color: u/**/rl(data:text/plain,hello) }', root)).toThrow()
  })
})
