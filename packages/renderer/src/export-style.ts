import { markdownConventionStyle } from './convention-style'

export const exportStyle = `${markdownConventionStyle}
@page { size: A4; margin: 20mm; }
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #20251f; font: 16px/1.65 "Manuslip CJK", "Segoe UI", system-ui, sans-serif; overflow-wrap: anywhere; }
article { max-width: 850px; margin: 0 auto; padding: 24px; }
h1,h2,h3,h4,h5,h6 { line-height: 1.3; break-after: avoid; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
p,ul,ol,blockquote,pre,table { margin-block: 1em; }
dl { margin-block: 1em; } dt { font-weight: 600; }
dd { margin-block: .25em .85em; margin-inline: 1.25em 0; }
dd > :first-child { margin-block-start: 0; } dd > :last-child { margin-block-end: 0; }
code,pre { font-family: "Manuslip CJK", Consolas, "Liberation Mono", monospace; font-size: .9em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #ccd0c7; padding: 12px; background: #f5f6f2; }
blockquote { margin-inline: 0; border-inline-start: 3px solid #88977b; padding-inline-start: 16px; }
table { border-collapse: collapse; border-spacing: 0; width: 100%; table-layout: auto; text-align: start; font: inherit; line-height: 1.6; font-variant-numeric: tabular-nums; }
th,td { border: 1px solid #aeb6a6; padding: 8px 12px; text-align: inherit; vertical-align: top; }
:is(th,td)[align="left" i] { text-align: left; }
:is(th,td)[align="center" i] { text-align: center; }
:is(th,td)[align="right" i] { text-align: right; }
th { font-weight: 600; background: #f5f6f2; }
tbody tr:nth-child(even) { background: #f5f6f2; }
thead { display: table-header-group; } tr { break-inside: avoid; }
a { color: #285b32; text-decoration: underline; } img,svg { max-width: 100%; height: auto; }
img { object-fit: contain; max-height: 240mm; } [data-export-kind="diagram"], [data-export-kind="display-math"] { break-inside: avoid; text-align: center; margin-block: 1em; }
[data-export-kind="math"] { display: inline-block; max-width: 100%; overflow: auto; vertical-align: baseline; line-height: 0; }
[data-export-kind="math"] > svg { display: block; }
hr { border: 0; border-top: 1px solid #aeb6a6; } input { accent-color: #365d36; }
.reading-export-note { font: 13px/1.5 "Manuslip CJK", "Segoe UI", system-ui, sans-serif; border-bottom: 1px solid #aeb6a6; padding-bottom: 12px; }
.reading-pair { min-width: 0; padding-block: 12px; border-bottom: 1px solid #ccd0c7; }
.reading-side-by-side > .reading-pair { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 24px; }
.reading-layout :is(.reading-original,.reading-translation) { min-width: 0; }
.reading-layout :is(.reading-original,.reading-translation)::before { content: attr(aria-label); display: block; font: 600 12px/1.5 "Manuslip CJK", "Segoe UI",system-ui,sans-serif; color: #4d5948; margin-bottom: 8px; }
.reading-layout :is(.reading-original,.reading-translation) > :first-child { margin-top: 0; }
.reading-interlinear .reading-translation { margin-top: 16px; padding-inline-start: 16px; border-inline-start: 2px solid #88977b; }
@media screen and (max-width: 600px) { .reading-side-by-side > .reading-pair { grid-template-columns: minmax(0,1fr); } }
@media print { article { max-width: none; padding: 0; } a { color: inherit; } }
`
