# Where Noto stands against Typora

Measured on 2026-09-01 against the Typora on this machine, its stylesheets on
disk, the author's own theme (`Typora_Claude-Like_Theme`), and the author's
vault: 7,066 notes, 82.5 MB of markdown, 343 image files, six levels deep.
Assessments below are ordered by how much each one accounts for the difference
in feel, and each names its evidence.

## 1. Images did not render. Closed, with one remainder.

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

The remainder: 960 pictures in this vault are raw HTML `<img>` tags rather
than markdown images, and those render as the opaque HTML block they are in.
Recognising an `<img>` inside inline or block HTML is a separate pass over a
different node type, and it is listed below with the plugins.

## 2. The prose is a size louder than the theme, and headings do not scale

The author's theme sets a 16px body at 1.58 leading with headings in em, so
`h1` is 1.84em, `h2` 1.48em, `h3` 1.24em, weight 600, and they follow the body.
Noto sets an 18px body at 1.62 with headings in pixels: 34, 27, 22, fixed. Two
consequences. Every heading is a step louder relative to its paragraph than the
theme the author reads all day. And the text size setting added last week moves
the body and leaves the headings where they were, because a pixel does not know
what an em is. Headings move to em, at the theme's ratios.

The theme's measure is 860px at 16px, about 54em. Noto's default of 66ch in an
18px serif is close; the difference in feel comes from the scale above, not the
width.

## 3. Tables draw every cell border

The theme draws horizontal rules only: a strong rule above the header and below
the table, a lighter rule between rows, no vertical lines at all, and no
alternating fill. Noto draws a 1px border on every cell. In the author's own
screenshot the table is the most visible difference between the two windows.

## 4. Code blocks have no line numbers

The author's `fence-enhance` plugin adds a gutter of line numbers, a language
label and a copy button to every fence. Noto shows the language on hover and
nothing else. The line numbers are the part that changes how a code block reads
at a glance.

## 5. The file tree has no icons

Typora prefixes every row with a file or folder glyph; the author's tree shows
them. Noto's rows are text and a twisty. With the connector lines in place the
tree is legible without them, but they are what makes a row of names read as
files rather than as an outline.

## 6. Inline code is bare

The theme gives inline code a border, a fill, a small radius and `0.9em`. Noto
sets a monospace face at 14px and nothing else, so `A400_Languages` sits in a
sentence with no edge. Small, but it is in nearly every paragraph of this vault.

## 7. Plugins: eight of sixteen, in some form

Real ports: Title Shift, Markdown Padding. Native equivalents: `wider` is the
width chord, `tree-guides` is the connector lines, `fuzzy-search` is quick open
with content search, `note-assistant` is quick open's link mode with wiki-link
rendering. Not done: `fence-enhance`, `sidenote`, `trail`, `timeline`,
`todo-manager`, `file-tags`, `code-viewer`, `drawio`; `recent-files` exists as a
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
behind it; done, bar the HTML `<img>` remainder. Then the prose scale, tables
and inline code together, since they are one stylesheet and one pass with the
theme open beside it. Then line numbers and tree icons, which are each a
morning. Then `<img>` inside HTML, which is the last of the pictures. The
remaining plugins after that, in the order the author names them.
