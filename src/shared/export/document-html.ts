/**
 * A note as a page that stands on its own.
 *
 * What HTML export produces, and what PDF export is printed from, so the two
 * cannot look different from each other.
 *
 * The stylesheet here is not the application's. The application's describes a
 * window: a rail, a title bar, a status line, a writing column sized against a
 * canvas that an exported file does not have. This one describes a document, and
 * it is written out in full rather than linked, because an exported file that
 * needs a second file to look right is not one you can send to anybody.
 *
 * Pure, so what the export writes can be tested without a browser.
 */

/**
 * The typography of the reading column, restated for a page.
 *
 * The measurements are the editor's own: the same 15px body, the same 1.58
 * leading, the same 796px column that Typora's 860px page leaves for text once
 * its gutters are taken off. What changes is everything about the window.
 */
const STYLES = `
:root {
  --ink: #34312E;
  --muted: #6F6B66;
  --paper: #FFFFFF;
  --raised: #F4F2ED;
  --hairline: rgb(32 30 28 / 0.12);
  --accent: #A85D3B;
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 56px 32px 96px;
  max-width: 860px;
  background: var(--paper);
  color: var(--ink);
  font: 15px/1.58 'Source Han Serif SC', 'Songti SC', Georgia, 'Times New Roman', serif;
  /* Chinese and Latin are set in one paragraph throughout this vault, and the
     Latin has to hold its own next to a Han character rather than shrink. */
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 0.6em; line-height: 1.3; font-weight: 600; }
h1 { font-size: 1.9em; margin-top: 0; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }
h4, h5, h6 { font-size: 1.05em; }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid rgb(168 93 59 / 0.3); }
ul, ol { padding-left: 1.6em; }
li { margin: 0.25em 0; }
li > input[type="checkbox"] { margin-right: 0.4em; }
blockquote {
  margin-left: 0;
  border-left: 2px solid var(--hairline);
  padding: 0.1em 0 0.1em 1em;
  color: var(--muted);
}
code {
  background: var(--raised);
  border-radius: 3px;
  padding: 0.1em 0.35em;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.88em;
}
pre {
  background: var(--raised);
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
}
pre code { background: none; padding: 0; font-size: 0.85em; line-height: 1.55; }
table { border-collapse: collapse; width: 100%; font-size: 0.94em; }
th, td { border-bottom: 1px solid var(--hairline); padding: 7px 10px; text-align: left; }
th { font-weight: 600; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid var(--hairline); margin: 2em 0; }
/* The colours Prism's tokens are given in the editor, restated for a page. The
   markup is already in the exported file; without these it is correct and grey. */
.token.comment, .token.prolog, .token.doctype, .token.cdata { color: #8A857D; font-style: italic; }
.token.punctuation { color: #6F6B66; }
.token.property, .token.tag, .token.constant, .token.symbol, .token.deleted { color: #A8503B; }
.token.boolean, .token.number { color: #8A5A2B; }
.token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #4E7A4A; }
.token.operator, .token.entity, .token.url { color: #6F6B66; }
.token.atrule, .token.attr-value, .token.keyword { color: #7A5AA8; }
.token.function, .token.class-name { color: #2F6F9F; }
.token.regex, .token.important, .token.variable { color: #A8703B; }
.token.important, .token.bold { font-weight: 600; }
.token.italic { font-style: italic; }

/* Front matter is metadata rather than prose, and reads as a header when it is
   set apart rather than dropped into the middle of the first page. */
.noto-frontmatter {
  background: var(--raised);
  border-radius: 6px;
  padding: 12px 14px;
  color: var(--muted);
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.8em;
  white-space: pre-wrap;
}

/* KaTeX is reduced to MathML on the way out, which the browser draws itself. */
math { font-size: 1.05em; }

/* Printing is the point of the PDF path, so the page breaks are chosen rather
   than left to land in the middle of a heading or across a table row. */
@media print {
  body { padding: 0; max-width: none; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid-page; }
  pre, blockquote, table, img { break-inside: avoid; }
  a { color: var(--ink); border-bottom: 0; }
}
`.trim();

/** Only the five characters that can end an element or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface StandalonePage {
  /** The note's name, without its extension. Becomes the title. */
  readonly title: string;
  /** The document's body, already serialized from the editor's own schema. */
  readonly body: string;
  /** False writes the markup alone, which is Typora's "HTML without styles". */
  readonly styled: boolean;
}

export function standaloneHtml(page: StandalonePage): string {
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.title)}</title>`,
    page.styled ? `<style>\n${STYLES}\n</style>` : null,
  ].filter((line): line is string => line !== null);

  return `<!doctype html>
<html>
<head>
${head.map((line) => `  ${line}`).join('\n')}
</head>
<body>
${page.body}
</body>
</html>
`;
}
