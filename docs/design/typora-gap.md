# Where Noto stands against Typora

Measured on 2026-09-01 against the Typora on this machine, its stylesheets on
disk, the author's own theme (`Typora_Claude-Like_Theme`), and the author's
vault: 7,066 notes, 82.5 MB of markdown, 343 image files, six levels deep.
Assessments below are ordered by how much each one accounts for the difference
in feel, and each names its evidence.

## 1. Images did not render. Closed.

2,466 of the 7,066 notes embed an image, and until this week Noto showed none
of them. A local `![](./pic.png)` failed with `net::ERR_UNEXPECTED`; a remote
one was refused by the renderer's content security policy, which was
`img-src 'self' data: blob:` with `connect-src 'none'`. Most of the vault's
images are remote: 5,516 are `https:` and 7 are `http:`, 2,482 of them on a
Huawei OBS bucket and 2,871 on `nihaixiahope.com`. 204 are paths relative to
the note, and most of those climb to a sibling assets folder
(`../.gitbook/assets/...`); 136 are percent-encoded; 5 are absolute.

What shipped. Web images load, behind a switch that is on by default because
that is what a reader expects, with a line in preferences saying that every one
is a request to the server that holds it. The switch is gated in the renderer,
so turning it off takes effect on the page in front rather than after a
restart; `connect-src` stays `'none'`, so a note can show a picture and still
cannot fetch anything, and the seven `http:` pictures are asked for over TLS
rather than in the clear. Local images are served by main through the app's own
origin from two roots and no others: the open folder, and the folder the note
in front is in. The real path is checked after every link is followed, and
only names that end in an image extension are served. A picture that cannot be
shown, for any reason, is a small labelled frame carrying the note's own alt
text and the reason, not a gap. Opening a folder after the note redraws the
note's images, so a picture in a sibling folder that was refused a moment ago
appears without the note being reopened.

The remainder, now closed: 960 pictures in this vault are raw HTML `<img>`
tags rather than markdown images, 767 of them in the shape Typora pastes
(`<img src alt style="zoom:50%" />`), 736 alone on a line and 164 inside a
sentence. Raw HTML is still never rendered live. A lone `<img>` tag is parsed,
strictly, into the few attributes a picture needs, the source, alt, title,
width, height, and a zoom or width from the style, and everything else is
dropped; those are drawn through the same frame as a markdown image, so the
zoom Typora wrote is honoured. While the caret is elsewhere the tag shows as
its picture; when the caret enters the block the source comes back, which is
Typora's rule. The source is never removed from the block, only kept out of
sight, so editing is unchanged.

## 2. The prose was a size louder than the theme, and headings did not scale. Closed.

The author's theme sets a 16px body at 1.58 leading with headings in em, so
`h1` is 1.84em, `h2` 1.48em, `h3` 1.24em, weight 600, and they follow the body.
Noto set an 18px body at 1.62 with headings in pixels: 34, 27, 22, fixed. Two
consequences. Every heading was a step louder relative to its paragraph than
the theme the author reads all day. And the text size setting moved the body
and left the headings where they were, because a pixel does not know what an
em is.

Now the default is 15px at the theme's 1.58 (a step under the theme's own 16:
set beside Typora, 16 still read a size louder to the author's eye, and 15 is
where the two windows matched), the headings are the theme's em
ratios with its margins scaled by the document size rather than the root, and
the block rhythm is its 0.74em above and below, collapsing. Bold is 600 in the
strong ink tier, links are in the accent with the underline held to a third,
lists have the theme's indent and a muted marker, and a loose list is drawn
with room inside its items while a tight one is not, which needed the parser's
`spread` flag to reach the DOM. The reading column is 860px, which is the
theme's width at this size.

## 3. Tables drew every cell border. Closed.

The theme draws horizontal rules only: a strong rule above the header and below
the table, a lighter rule between rows, no vertical lines at all, and no
alternating fill. Noto drew a 1px border on every cell. In the author's own
screenshot the table was the most visible difference between the two windows.
Noto now draws the theme's rules, in the prose face at 0.92em with lining
tabular figures, and the first column in the strong ink tier as the theme has
it.

## 4. Code blocks had no line numbers. Closed, bar two extras.

The author's `fence-enhance` plugin adds a gutter of line numbers, a language
label and a copy button to every fence. Noto showed the language on hover and
nothing else. The line numbers are the part that changes how a code block
reads at a glance.

A fence is now a node view: a gutter column of numbers in the plugin's rule,
as wide as the block's own line count and never narrower than two digits,
beside the code, which no longer wraps so the two stay in step; the language
and a copy button share the corner and show while the pointer is over the
block or the caret is in it. The numbers are not content: a selection never
takes them and copying copies code. A switch turns them off, on by default as
the author's Typora is set. The plugin's indent guides and tab markers are not
ported; each needs a per-line element inside the fence, which the editor does
not have, and they are listed with the plugins below.

## 5. The file tree had no icons. Closed.

Typora prefixes every row with a file or folder glyph; the author's tree shows
them. Noto's rows were text and a twisty. With the connector lines in place the
tree was legible without them, but they are what makes a row of names read as
files rather than as an outline. Every row now carries one, drawn inline in
the title bar's stroke style in the muted tier, a folder's flap lifting when
it is open; a file row carries the twisty's width as a spacer so the glyphs of
one level form a column.

## 5b. Blocks did not share the text's left edge. Closed.

Every top-level block carried a 14px padding for the heading markers, so a
paragraph's first letter sat 14px in from the block's edge while a fence, a
table or a quote drew its box from that edge: every filled block stuck out to
the left of the text it sat between, which the author drew a red line against.
The gutter is now the document's, once, on the editor itself, and a block's
box and a paragraph's first glyph share one left edge.

## 5c. Alerts rendered as plain quotes. Closed.

`> [!NOTE]` and its four siblings, which the vault holds by the hundred, drew
as a quote with the marker showing. They are now callouts as Typora draws
them: a rule and a tint in the kind's colour, an icon and a title in place of
the marker, the marker itself back while the caret is inside. Decorations over
an ordinary quote, so the file keeps its marker line byte for byte.

## 5d. A fence had a label but no way to set its language. Closed.

The language in the fence's corner is now a field, with the highlighter's
names offered as you type, and setting it writes the fence's info string as
one undoable change and colours the block.

## 5e. Typora's own inline marks were plain text. Closed.

`==highlight==` is in 960 places in the vault, `^superscript^` in 363 and
`~subscript~` in 254. None is CommonMark, so the parser kept them as text and
the editor showed the delimiters. They are now drawn as Typora draws them,
through decorations: the inner text takes the mark, the delimiters hide, and
both come back muted while the selection touches the block. The file keeps
every delimiter. The scan is incremental, one paragraph per keystroke, so the
two-megabyte corpus documents pay nothing for it.

## 5f. The inline HTML a note writes for a key, a formula or a break showed as source. Closed.

`<br>` sits in 567 lines of the vault, `<sub>` in 86, `<kbd>` in 81, `<sup>`
in 37 and `<u>` in 20. A bare formatting tag with no attributes, and the text
between it and its closing tag, is now drawn as the shape it names; the tags
hide and return with the caret. A `<br>` breaks the line and shows its source
only while the block is being edited. A tag carrying attributes, `<span
style>` above all, is left as source, since drawing an author's inline
style would mean trusting it.

## 5g. The highlighter knew twenty languages; the vault fences forty. Closed.

Haskell alone is fenced 319 times, and it was not loaded; nor were Ruby, Lua,
PHP, C#, PowerShell, HTTP, Vim script, Nginx, INI, Dockerfile or Makefile,
which together account for a thousand more. Every language the vault fences
more than fifty times now has its grammar, with the short names an author
actually types (`hs`, `rb`, `ps1`, `dockerfile`, `jsonc`, `elisp`) mapped to
it. `text`, `console` output and the odd `undefined` stay unpainted, which is
right for them.

## 5h. A mermaid fence showed its source. Closed.

The vault fences 121 mermaid diagrams in 77 notes, flowcharts and sequence
diagrams above all, and Typora draws every one. Noto showed the source in a
code box. A mermaid fence is now drawn as its diagram: only the drawing while
the caret is elsewhere, on the page and not in a box, and the source above
the drawing in the fence's own box while the caret is in it; a press on the
drawing puts the caret in the source, and a diagram that cannot be drawn says
so under where it would be, with the source untouched. The palette is the
document's, read from the tokens at each drawing, so a theme file and the
dark theme reach the diagram too.

The drawing happens in a frame sandboxed to nothing. Mermaid writes an SVG
full of inline styles, which the editor's content security policy refuses,
and it draws text the reader wrote, which the editor does not run; so the
frame has no origin, no bridge to main and no way to reach the page that
holds it, and the only thing that crosses is the source and the palette going
in and a height or an error coming out. The file keeps its bytes: the drawing
is a view of the fence, never its content.

## 5i. Frame by frame against the author's window. Closed, for this frame.

The author's Typora window and Noto were put on the same note at the same
size, 1274 by 698, and compared. What differed, and what changed:

Tables were the loudest. Noto laid them out with fixed, equal columns and let
words break anywhere, so `patents_detail.description` wrapped mid-word and
every row was two lines tall; Typora sizes each column to what it holds.
Columns now take their content's width, long words break only when the
table has run out of room, and the cells carry the theme's padding, row
rule and hover wash.

The sidebar was set in the interface sans; Typora's is in the body serif,
which makes the tree read as part of the same page as the note. It is the
serif now, the folder glyph is a filled shape as Typora's is rather than a
wire outline, the stuck rows carry the theme's hairline and its faint
shadow rather than a strong rule, the tabs are set as Typora sets its
sidebar heading, small capitals with no indicator, and the rail opens at
272 rather than 248, which is what a vault of long Chinese names needs.

The title bar cut the file name to an ellipsis to make room for two folders
and a marker. Only the folder the note is in is shown now, and it gives way
before the name does. The status strip repeated the path under a rule on a
panel of its own; Typora has no such bar. The strip keeps the state and the
recent notes on the page itself, with no rule and no fill. Scrollbars were
the system's classic ones; they are the theme's thin thumb now, shown
while the pointer is over the pane.

Smaller: the quote is the theme's box, a quiet rule on a fill with text a
step lighter; a fence has the theme's radius and its extra air; a rule is
as faint as the theme draws it; a picture has the theme's inside hairline;
the caret is the accent, and a selection is the accent at a wash, where
before it was the system blue because nothing had set it.

## 6. Inline code was bare. Closed.

The theme gives inline code a border, a fill, a small radius and `0.9em`. Noto
set a monospace face at 14px and nothing else, so `A400_Languages` sat in a
sentence with no edge. Small, but it is in nearly every paragraph of this
vault. Inline code now has the theme's hairline, fill, radius and its own warm
ink, at 0.9em of the prose so it follows the size setting; a fence has the
same hairline and no edge on the code inside it, since the fence is the edge.

## 7. Plugins: eight of sixteen, in some form

Real ports: Title Shift, Markdown Padding. Native equivalents: `wider` is the
width modes, `tree-guides` is the connector lines and the sticky folders,
`fuzzy-search` is quick open with content search, `note-assistant` is quick
open's link mode with wiki-link rendering, `fence-enhance` is the fence gutter
with its language and copy button, and `trail` is back and forward in the
title bar and the Go menu, three notes each way. Not done: `sidenote`,
`timeline`, `todo-manager`, `file-tags`, `code-viewer`, `drawio`, and
`fence-enhance`'s indent guides and tab markers; `recent-files` exists as a
menu and a status strip rather than as the plugin's behaviour, and
`remote-control` is infrastructure rather than a feature.

## Where Noto is ahead

Saves are byte exact for every block the reader did not touch; Typora rewrites
the file through its serializer. Noto opens the 2 MB and 8 MB corpus documents;
Typora reports an empty document after three minutes on either. The rail is
resizable and remembered. Quick open ranks by frecency and searches bodies from
the same box. Plugins declare capabilities and main brokers every one, which is
a plugin model Typora does not have.

## Order of work

Images first, because the gap was functional and a third of the vault was
behind it; done, including `<img>` inside HTML. Then the prose scale, tables
and inline code together, since they are one stylesheet and one pass with the
theme open beside it; done. Then line numbers and tree icons; both done. The
remaining plugins after that, in the order the author names them, with
`fence-enhance`'s indent guides and tab markers among them.
