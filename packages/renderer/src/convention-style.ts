/** Shared by the desktop writing surface, reading copies and self-contained export. */
export const markdownConventionStyle = `
.markdown-alert {
  --callout-color: light-dark(#315e7a, #9cc8e3);
  margin-inline: 0;
  padding: .6em 1em;
  border-inline-start: 1px solid var(--callout-color);
  background: color-mix(in srgb, var(--callout-color) 5%, var(--paper, #fff));
  color: var(--text, #30302e);
}
.markdown-alert-tip { --callout-color: light-dark(#3c6544, #acd4a9); }
.markdown-alert-important { --callout-color: light-dark(#67518a, #cbb5ec); }
.markdown-alert-warning { --callout-color: light-dark(#785a16, #e0c581); }
.markdown-alert-caution { --callout-color: light-dark(#964043, #f0aaab); }
.markdown-alert > .markdown-alert-title {
  color: var(--callout-color);
  font-weight: 600;
  margin-block: 0 .4em;
}
.markdown-alert > :last-child { margin-block-end: 0; }
.markdown-toc { margin-block: 1em; }
.markdown-toc ul { padding-inline-start: 1.4em; margin-block: .3em; }
.markdown-toc > ul { padding-inline-start: 1.2em; }
.markdown-toc a { display: inline-block; min-height: 24px; text-underline-offset: .18em; }
.markdown-toc a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
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
}
`
