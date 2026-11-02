import { describe, expect, it } from 'vitest'
import { convertHtml } from '../../../../src/main/clipboard/conversion'

describe('local clipboard HTML conversion', () => {
  it('preserves headings, emphasis, lists, GFM tables, tasks, and strikethrough', () => {
    const result = convertHtml(
      '<h2>标题</h2><p><strong>Bold</strong> <em>em</em> <del>old</del></p><ul><li><input type="checkbox" checked>Done</li></ul><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>One</td><td>1</td></tr></tbody></table>',
    )
    expect(result).toContain('## 标题')
    expect(result).toContain('**Bold** _em_ ~old~')
    expect(result).toContain('[x] Done')
    expect(result).toContain('| Name | Value |')
    expect(result).toContain('| One | 1 |')
  })
  it('keeps code literal and uses fences which cannot be closed by the code', () => {
    const result = convertHtml(
      '<pre><code>```\nconst a = &quot;&lt;script&gt;&quot;\n```</code></pre>',
    )
    expect(result).toContain('````\n```\nconst a = "<script>"\n```\n````')
  })
  it('escapes table pipes and keeps highlighted code inside a sufficient fence', () => {
    expect(convertHtml('<table><tr><th>A | B</th></tr><tr><td>1 | 2</td></tr></table>')).toContain(
      '| 1 \\| 2 |',
    )
    expect(
      convertHtml('<div class="highlight-source-js"><pre>```\ncode\n```</pre></div>'),
    ).toContain('````js\n```\ncode\n```\n````')
  })
  it('does not execute or retain active HTML or executable URLs', () => {
    const result = convertHtml(
      '<script>globalThis.compromised=true</script><style>body{display:none}</style><iframe src="https://example.com"></iframe><svg><script>bad()</script></svg><p><a href="javascript:alert(1)">Keep text</a><img alt="blocked" src="file:///secret.png" onerror="bad()"></p>',
    )
    expect(result).toBe('Keep textblocked')
    expect('compromised' in globalThis).toBe(false)
  })
  it('retains HTTPS and relative image references but excludes ambient protocol and drive paths', () => {
    const result = convertHtml(
      '<a href="https://example.com/a?b=1">Link</a><img alt="Local" src="assets/a%20b.png"><img alt="Drive" src="C:/secret.png"><img alt="UNC" src="//server/a.png">',
    )
    expect(result).toContain('[Link](<https://example.com/a?b=1>)')
    expect(result).toContain('![Local](<assets/a%20b.png>)')
    expect(result).not.toContain('C:/')
    expect(result).not.toContain('//server')
  })
  it('rejects input by UTF-8 bytes, including multibyte text', () => {
    expect(() => convertHtml('界'.repeat(400_000))).toThrow('paste-large')
  })
  it('does not persist temporary asset capabilities from clipboard HTML', () => {
    expect(
      convertHtml(
        '<p><img alt="Picture" src="manuslip-asset://image/12345678-1234-1234-1234-123456789abc"></p>',
      ),
    ).toBe('Picture')
  })
})
