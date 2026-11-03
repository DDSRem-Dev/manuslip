import { documentIconStyle } from './document-icons'
import { markdownReferenceStyle } from './reference-style'

/** Shared by the desktop writing surface, reading copies and self-contained export. */
export const markdownConventionStyle = `${documentIconStyle}${markdownReferenceStyle}
.markdown-alert {
  --callout-color: light-dark(#315e7a, #9cc8e3);
  margin-inline: 0;
  padding: .75em 1em;
  border-inline-start: 1px solid var(--callout-color);
  background: color-mix(in srgb, var(--callout-color) 5%, var(--paper, #fff));
  color: var(--text, #30302e);
}
.markdown-alert-tip { --callout-color: light-dark(#3c6544, #acd4a9); }
.markdown-alert-important { --callout-color: light-dark(#67518a, #cbb5ec); }
.markdown-alert-warning { --callout-color: light-dark(#785a16, #e0c581); }
.markdown-alert-caution { --callout-color: light-dark(#964043, #f0aaab); }
.markdown-alert > .markdown-alert-title {
  display: flex;
  align-items: center;
  gap: .5em;
  color: var(--callout-color);
  font-weight: 600;
  line-height: 1.5;
  margin-block: 0 .5em;
}
.markdown-alert > .markdown-alert-title + * { margin-block-start: 0; }
.markdown-alert > .markdown-alert-title .markdown-icon { color: inherit; }
.markdown-alert > :last-child { margin-block-end: 0; }
.markdown-toc { margin-block: 1em; }
.markdown-toc ul { padding-inline-start: 1.4em; margin-block: .3em; }
.markdown-toc > ul { padding-inline-start: 1.2em; }
.markdown-toc a { display: inline-block; min-height: 24px; text-underline-offset: .18em; }
.markdown-toc a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
:is(.cm-live-rendered, .reading-article, article) b { font-weight: 600; }
:is(.cm-live-rendered, .reading-article, article) :is(u, ins) { text-underline-offset: .15em; }
:is(.cm-live-rendered, .reading-article, article) small { font-size: .875em; }
:is(.cm-live-rendered, .reading-article, article) abbr[title] {
  text-decoration: underline dotted;
  text-underline-offset: .18em;
  cursor: help;
}
:is(.cm-live-rendered, .reading-article, article) :is(kbd, samp, var) {
  font-family: var(--font-mono, "Manuslip CJK", ui-monospace, "Cascadia Code", Consolas, monospace);
  font-size: .875em;
}
:is(.cm-live-rendered, .reading-article, article) kbd {
  padding: .1em .35em;
  border: 1px solid var(--input-border, #92928b);
  border-radius: 3px;
  background: var(--surface, #f7f7f5);
  color: inherit;
  font-weight: 500;
  box-decoration-break: clone;
}
:is(.cm-live-rendered, .reading-article, article) kbd kbd { padding: 0; border: 0; background: none; font-size: 1em; }
:is(.cm-live-rendered, .reading-article, article) figure { margin: 1em 0; min-inline-size: 0; }
:is(.cm-live-rendered, .reading-article, article) figure > :first-child { margin-block-start: 0; }
:is(.cm-live-rendered, .reading-article, article) :is(caption, figcaption) {
  color: var(--muted, #6b6b65);
  font-size: .875em;
  font-weight: 400;
  line-height: 1.6;
  text-align: start;
  overflow-wrap: anywhere;
}
:is(.cm-live-rendered, .reading-article, article) caption { padding-block: 0 .6em; }
:is(.cm-live-rendered, .reading-article, article) figcaption { margin-block: .6em 0; }
:is(.cm-live-rendered, .reading-article, article) rt { color: var(--muted, #6b6b65); font-size: .6em; }
:is(.cm-live-rendered, .reading-article, article) mark {
  background: light-dark(#fff0ab, #665316);
  color: inherit;
  padding-inline: .08em;
  box-decoration-break: clone;
}
:is(.cm-live-rendered, .reading-article, article) :is(sub, sup) { font-size: .75em; line-height: 0; }
@media (forced-colors: active) {
  .markdown-alert { border-color: CanvasText; }
  .markdown-alert > .markdown-alert-title { color: CanvasText; }
  :is(.cm-live-rendered, .reading-article, article) mark { background: Mark; color: MarkText; }
  :is(.cm-live-rendered, .reading-article, article) kbd { border-color: CanvasText; }
  :is(.cm-live-rendered, .reading-article, article) :is(caption, figcaption, rt) { color: CanvasText; }
}
`
