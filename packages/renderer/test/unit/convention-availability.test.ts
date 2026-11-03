import { type MarkdownPlugins, markdownPluginNames, parseDocumentMarkdown } from '@manuslip/core'
import { extractTranslation, reconstructSharedTranslation } from '@manuslip/translate'
import { describe, expect, it } from 'vitest'
import { renderExport } from '../../src/export'
import { renderMarkdown } from '../../src/index'

const source = `---
title: YAML_METADATA_PRIVATE
tags: [writing, reading]
---

# Availability {#availability .wide}

[TOC]

==Highlight== ~~Deleted~~ H~2~O x^2^. "Smart" -- punctuation...

https://example.invalid/literal

> [!NOTE]
> Nested ==highlight== and $x^2$.

| Name | Value |
| :--- | ---: |
| One | Two |

- [x] Checked task
- [ ] Unchecked task

3. [ ] Ordered task

Inline $E=mc^2$.

$$
\\frac{a}{b}
$$

~~~mermaid
flowchart LR
A-->B
~~~

> ~~~mermaid
> flowchart LR
> C-->D
> ~~~

A footnote[^one].

[^one]: Footnote body.

Inline note^[Inline footnote body.].

<details>
<summary>Literal tags</summary>
**Disclosure body**
</details>

~~~text
==literal== $x$ [TOC] ~~code~~
~~~
`

const combinations = Array.from({ length: 32 }, (_, mask) => ({
  mask,
  plugins: Object.fromEntries(
    markdownPluginNames.map((name, index) => [name, Boolean(mask & (1 << index))]),
  ) as unknown as MarkdownPlugins,
}))

describe('Markdown feature availability across every plugin combination', () => {
  it.each(combinations)(
    'keeps the base grammar and isolates plugins for mask $mask',
    ({ plugins }) => {
      const document = parseDocumentMarkdown(source, plugins)
      const options = {
        rawHtml: false,
        footnotesLabel: 'Footnotes',
        footnoteBackLabel: 'Back',
        plugins,
      }
      const plan = extractTranslation(document.root, source)
      expect(
        JSON.stringify(plan.units.map((unit) => unit.payload)).includes('YAML_METADATA_PRIVATE'),
      ).toBe(!plugins.typora)
      const outputs = new Map(
        plan.units.flatMap((unit) =>
          unit.payload
            ? [[unit.occurrenceId, unit.payload.text.replace(/Highlight/g, '高亮')] as const]
            : [],
        ),
      )
      const reading = reconstructSharedTranslation(plan, outputs, {
        retained: 4 * 1024 * 1024,
        staging: 4 * 1024 * 1024,
      })
      for (const root of [document.root, reading.root]) {
        const preview = renderMarkdown(root, options)
        const exported = renderExport(root, options)
        for (const html of [preview.html, exported.html]) {
          for (const basic of [
            '<table>',
            '<del>Deleted</del>',
            '<sub>2</sub>',
            '<sup>2</sup>',
            'type="checkbox" checked disabled',
            '<ol start="3"',
            'data-footnote-ref',
            'Inline footnote body.',
            '&#x3C;details>',
            '<strong>Disclosure body</strong>',
            'id="availability"',
            'class="wide"',
            '“Smart” — punctuation…',
            '==literal== $x$ [TOC] ~~code~~',
          ])
            expect(html, basic).toContain(basic)
          expect(html.includes('<mark>')).toBe(plugins.opt)
          expect(html.includes('markdown-alert-note')).toBe(plugins.github)
          expect(html.includes('class="markdown-toc"')).toBe(plugins.typora)
          expect(html.includes('YAML_METADATA_PRIVATE')).toBe(!plugins.typora)
          expect(html.includes('href="https://example.invalid/literal"')).toBe(plugins.github)
        }
        expect(preview.blocks.some((block) => block.kind === 'diagram')).toBe(plugins.mermaid)
        expect(exported.slots.filter((slot) => slot.kind === 'diagram')).toHaveLength(
          plugins.mermaid ? 2 : 0,
        )
        expect(exported.slots.filter((slot) => slot.kind === 'math')).toHaveLength(
          plugins.latex ? 3 : 0,
        )
      }
    },
  )
})
