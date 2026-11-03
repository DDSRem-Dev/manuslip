/** The same note typography in writing, translated reading, HTML and print. */
export const markdownReferenceStyle = `
.markdown-footnote-ref { margin-inline: .1em; }
.markdown-footnote-ref > a[data-footnote-ref] {
  padding: .08em .35em;
  border-radius: 3px;
  background: var(--surface, #f5f6f2);
  color: var(--text, #30302e);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  text-decoration: none;
  box-decoration-break: clone;
}
:is(.cm-live-rendered, .reading-article, article) a[data-footnote-backref] {
  display: inline-flex;
  align-items: center;
  gap: .1em;
  padding-inline: .2em;
  color: var(--muted, #62685f);
  text-decoration: none;
  white-space: nowrap;
  vertical-align: -.08em;
}
a[data-footnote-backref] > .markdown-icon {
  inline-size: 1em;
  block-size: 1em;
}
a[data-footnote-backref] > sup { position: relative; inset-block-start: -.3em; }
:is(.markdown-footnote-list, .footnotes > ol) {
  margin-block: 0;
  padding-inline-start: 1.75em;
  color: var(--text, #30302e);
  font-size: .875em;
  line-height: 1.65;
}
:is(.markdown-footnote-list, .footnotes > ol) > li {
  padding-inline-start: .25em;
  scroll-margin-block: 2em;
}
:is(.markdown-footnote-list, .footnotes > ol) > li::marker {
  color: var(--muted, #62685f);
  font-variant-numeric: tabular-nums;
}
:is(.markdown-footnote-list, .footnotes > ol) > li + li { margin-block-start: .5em; }
:is(.markdown-footnote-list, .footnotes > ol) > li > :first-child { margin-block-start: 0; }
:is(.markdown-footnote-list, .footnotes > ol) > li > :last-child { margin-block-end: 0; }
.footnotes {
  margin-block: 1.75em 0;
  padding-block-start: .75em;
  border-block-start: 1px solid var(--border, #ccd0c7);
}
.footnotes > .sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
:is(a[data-footnote-ref], a[data-footnote-backref]):focus-visible {
  outline: 2px solid var(--accent, #285b32);
  outline-offset: 3px;
  border-radius: 3px;
}
@media (hover: hover) {
  .markdown-footnote-ref > a[data-footnote-ref]:hover {
    background: var(--control-hover, #e7eae3);
  }
  :is(.cm-live-rendered, .reading-article, article) a[data-footnote-backref]:hover {
    color: var(--accent, #285b32);
    text-decoration: underline;
    text-underline-offset: .2em;
  }
}
@media (forced-colors: active) {
  .markdown-footnote-ref > a[data-footnote-ref] {
    background: Canvas;
    color: LinkText;
    outline: 1px solid LinkText;
  }
  :is(.cm-live-rendered, .reading-article, article) a[data-footnote-backref] { color: LinkText; }
  :is(a[data-footnote-ref], a[data-footnote-backref]):focus-visible { outline-color: Highlight; }
  .footnotes { border-color: CanvasText; }
}
@media print {
  .markdown-footnote-ref > a[data-footnote-ref] { background: none; color: inherit; }
}
`
