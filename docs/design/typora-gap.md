# Where Noto stands against Typora

Measured against the Typora on this machine, its stylesheets on disk, the
author's own theme (`Typora_Claude-Like_Theme`), and the author's vault: 7,066
notes, 82.5 MB of markdown, 343 image files, six levels deep. Every assessment
names its evidence, and where a number appears it was measured rather than
estimated: from the running Typora through its remote control, from the
packaged app through a driver, or from the vault itself.

Grouped by what part of the experience each one is about, rather than by when
it was found. Speed is not here: `docs/performance/large-documents.md` carries
what a large document costs and where the cost is.

# The document, as it is drawn

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

## 5. Blocks did not share the text's left edge. Closed.

Every top-level block carried a 14px padding for the heading markers, so a
paragraph's first letter sat 14px in from the block's edge while a fence, a
table or a quote drew its box from that edge: every filled block stuck out to
the left of the text it sat between, which the author drew a red line against.
The gutter is now the document's, once, on the editor itself, and a block's
box and a paragraph's first glyph share one left edge.

## 6. Inline code was bare. Closed.

The theme gives inline code a border, a fill, a small radius and `0.9em`. Noto
set a monospace face at 14px and nothing else, so `A400_Languages` sat in a
sentence with no edge. Small, but it is in nearly every paragraph of this
vault. Inline code now has the theme's hairline, fill, radius and its own warm
ink, at 0.9em of the prose so it follows the size setting; a fence has the
same hairline and no edge on the code inside it, since the fence is the edge.

## 7. Alerts rendered as plain quotes. Closed.

`> [!NOTE]` and its four siblings, which the vault holds by the hundred, drew
as a quote with the marker showing. They are now callouts as Typora draws
them: a rule and a tint in the kind's colour, an icon and a title in place of
the marker, the marker itself back while the caret is inside. Decorations over
an ordinary quote, so the file keeps its marker line byte for byte.

## 8. Typora's own inline marks were plain text. Closed.

`==highlight==` is in 960 places in the vault, `^superscript^` in 363 and
`~subscript~` in 254. None is CommonMark, so the parser kept them as text and
the editor showed the delimiters. They are now drawn as Typora draws them,
through decorations: the inner text takes the mark, the delimiters hide, and
both come back muted while the selection touches the block. The file keeps
every delimiter. The scan is incremental, one paragraph per keystroke, so the
two-megabyte corpus documents pay nothing for it.

## 9. The inline HTML a note writes for a key, a formula or a break showed as source. Closed.

`<br>` sits in 567 lines of the vault, `<sub>` in 86, `<kbd>` in 81, `<sup>`
in 37 and `<u>` in 20. A bare formatting tag with no attributes, and the text
between it and its closing tag, is now drawn as the shape it names; the tags
hide and return with the caret. A `<br>` breaks the line and shows its source
only while the block is being edited. A tag carrying attributes, `<span
style>` above all, is left as source, since drawing an author's inline
style would mean trusting it.

## 10. A mermaid fence showed its source. Closed.

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

## 11. A formula was drawn as an exhibit. Closed.

Typora gives a block of maths no box at all: centred on the page at the
body's own size, with room above and below and nothing drawn around it. This
put a rule and a fill and a smaller size around every one, so a document of
working read as a document of quotations. Inline maths was boxed too, and set
smaller than the sentence holding it.

## 12. A line the author broke is now drawn broken. Closed.

CommonMark reads a single newline inside a paragraph as a space, and so did
this. Typora draws it as a break, and the difference showed on any note with
a two-line quote or a wrapped sentence. The reasoning for collapsing had been
that such a newline is only where an editor happened to wrap the source; a
census of the vault says otherwise. There is no wrapping convention in it at
all, lines running from a few characters to nearly three thousand, and 2.7%
of its 213,471 paragraphs hold a newline. These notes were written in Typora,
where Enter starts a paragraph and only Shift+Enter puts a newline inside
one, so every one of those is a break somebody typed. They are kept now, and
drawn where they were typed.

## 13. Bold beside Chinese was not bold. Closed.

The largest single fault found in this run, and it was found by re-serializing
the vault rather than by looking at it. CommonMark decides whether a `**` run
can close from what sits either side of it, and it counts CJK punctuation as
punctuation, so `**注意：**一定` never closes: the reader saw asterisks where
they had written bold. A census of 300 notes found 596 of their 3,220 bold
runs unparsed for this reason, in a quarter of the files. Typora closes them,
and so does anybody reading the file.

Both halves of the CommonMark community's own CJK-friendly amendment are in
now, the reading half and the writing half. The reading half fixes the
rendering; the writing half matters just as much, because without it the
serializer keeps the old rules, decides the run cannot close, and escapes the
Chinese character after it into a numeric reference. Missed runs fell from 596
to 179.

## 14. A bare URL was not left as one. Closed.

Found by rendering real notes rather than a made-up one. Two faults, both on a
construct the vault uses 6,200 times.

Editing any paragraph holding a bare URL wrote it back as `<url>`. That is the
serializer's own default for a link whose text is its address, and it is
correct markdown, but it is not what these files say: 6,200 bare against 145
in angle brackets. A bare URL is written bare now, and only where that is
unambiguous, since GFM trims a trailing full stop or bracket off a bare
address and one that ends in punctuation has to keep its brackets or come back
a character shorter.

The other fault was on screen. Putting the caret in a paragraph reveals the
markdown of the inline thing it is in, and a bare URL was revealed as
`[url](url)`, showing syntax the file does not contain and inviting an edit
that would turn it into a different construct. A link whose text is its own
address now reveals nothing, because there is nothing to reveal.

# The window around it

## 15. The file tree had no icons. Closed.

Typora prefixes every row with a file or folder glyph; the author's tree shows
them. Noto's rows were text and a twisty. With the connector lines in place the
tree was legible without them, but they are what makes a row of names read as
files rather than as an outline. Every row now carries one, drawn inline in
the title bar's stroke style in the muted tier, a folder's flap lifting when
it is open; a file row carries the twisty's width as a spacer so the glyphs of
one level form a column.

## 16. The title bar was a band across the window. Closed.

Typora's sidebar and page each carry their own ground from the top of the
window to the bottom, so the two columns read as columns. This drew a single
panel-coloured bar across the whole width, which cut the page off from its
own title. The bar now carries the rail's ground above the rail and the
page's above the page, and the divide runs floor to ceiling.

## 17. Three bars of furniture where Typora has one. Closed.

Typora spends the top 28px of its window on the file's name and draws nothing
else: no bar down the side of the rail, no strip along the foot. This had
three. The rail carried a footer naming the folder, which the tree's own
first row already names, with the folder's actions behind it; those actions
now live on that first row, as a quiet ellipsis that comes up when the
pointer is on it, which is where an action belongs, on the thing it acts on.
The foot of the window carried a sentence that was always there, and a
promise that is always on screen stops being read; it is said when it
changes and fades. The title bar is 32 rather than 38.

## 18. Quick open read as ten copies of one path. Closed.

Every result showed its whole path, truncated at the right, and in a vault
whose paths share long prefixes that left ten rows reading identically: the
same forty characters, then an ellipsis. What tells two results apart is the
folder the note is in, so the filename goes, since the row already names it,
and the last two folders are what survives. The whole path is still there on
hover.

The keyboard's focus ring was drawn in near-black ink, which on a bordered
control read as a second border or as something being wrong. It is the accent
now, which is the one thing this interface uses to say where you are.

## 19. The outline never said which heading you were in. Closed.

A list of headings is asked two different questions. Navigating, it is asked
where to go, and this answered that. Writing, it is asked where am I, and this
said nothing: the outline looked the same whatever the caret was doing.
Typora marks the heading you are under; so does this now, in the same warm
grey the current file gets in the tree, following the caret as it moves and
resolving a paragraph to the heading above it.

The editor reports the top level block the caret is in whenever it changes,
which is a thing worth having anyway and cost one comparison per transaction.

# Measured against the running Typora

## 20. Frame by frame against the author's window. Closed, for this frame.

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

## 21. Measured against the running Typora, not guessed at. Closed.

With the remote control working, both editors could be asked the same
question at the same window size and their answers compared field by field:
every font, size, leading, weight, colour, margin, padding, border and
radius, for every construct in one note that holds them all.

The type was already right. Every difference in the document was the base
size and nothing else: Typora sets 16px, this is set to 15 at the author's
asking, and since everything is in em the two are the same drawing at
different sizes. What the measurement did find:

The reading column was 64px too wide. Typora caps its page at 860 including
its own 32px gutters, so the text is 796 across; the cap here had been set to
the whole box. The page had 26px of air above and 80 below; Typora has 32 and
104, and the deep foot is what lets the last paragraph be scrolled to eye
level. Three colours were near misses rather than matches: the strong ink,
and the quote's text and rule, are now the theme's own values.

Code was drawn in status colours, a string in the green that means success
and a keyword in the accent. The theme gives code five colours of its own,
and they are now read from it: purple for what the language reserves, green
for text, warm brown for numbers, blue for names the document defines, and
the muted tier for comments.

The tree was a size smaller and a third tighter than Typora's: 26px rows of
13px text against 32px rows of 14px. It is Typora's now, with the row height
in one place since the sticky offsets are multiples of it, every row quiet
except the one you are in, and the theme's own warm grey behind it.

A task item hung outside its list, because the whole item was pulled left to
make room for the box rather than the box being put where the bullet goes. A
finished one now recedes to the theme's colour, and is struck through only
when it is a loose item, which is the theme's own rule.

An alert's title sat on the same line as its first sentence.

## 22. A second pass with fresh eyes. Closed.

Six things a reader who had not been staring at it all day picked out.
Preferences opened with a focus ring around its Done button, so the eye landed
on a button before the settings; the dialog takes the focus now, which traps
the keys without drawing anything, and the ring appears when somebody actually
tabs. The panel was a fixed 560 tall, which left the shortest section a void
under its last control and a footnote pinned to an edge it had nothing to do
with; it is as tall as what is in it. The sidebar toggle turned into a filled
box when the rail was open, making the heaviest mark in the title bar an
accident of state; a mode that is on says so in colour, as the rail's own tabs
do, and the fill is kept for a button holding a menu open below it. In the
dark theme the lit branch was the loudest thing in the window, because the
same accent carries much further on a near-black rail than on paper; the tree
has its own accent now, the same hue at 62% in the dark. The scrollbars left
an opaque square where they met. And focus mode dimmed text but not fills, so
a quote or a callout still read as a solid rectangle beside a nearly
vanished paragraph; the author's theme answers this the same way, by taking
the fill off a callout in focus mode.

Frontmatter, which 3,440 notes in the vault carry, had a rule down its left
and 12px of padding against Typora's none and 16.

# Editing

## 23. A fence had a label but no way to set its language. Closed.

The language in the fence's corner is now a field, with the highlighter's
names offered as you type, and setting it writes the fence's info string as
one undoable change and colours the block.

## 24. The highlighter knew twenty languages; the vault fences forty. Closed.

Haskell alone is fenced 319 times, and it was not loaded; nor were Ruby, Lua,
PHP, C#, PowerShell, HTTP, Vim script, Nginx, INI, Dockerfile or Makefile,
which together account for a thousand more. Every language the vault fences
more than fifty times now has its grammar, with the short names an author
actually types (`hs`, `rb`, `ps1`, `dockerfile`, `jsonc`, `elisp`) mapped to
it. `text`, `console` output and the odd `undefined` stay unpainted, which is
right for them.

## 25. The keys Typora gives to the marks markdown has no key for. Closed.

Read out of Typora's own menus rather than from memory. Its headings, strong
and emphasis were already the same. What was missing: Underline on Command+U,
Highlight on Shift+Command+H, and, on Control rather than Command, inline code
on Control+`, strike on Control+Shift+`, and inline maths on Control+M. Its
Increase and Decrease Heading Level, Command+= and Command+-, walk the one
scale from a paragraph up to a first-level heading and back down again rather
than jumping to a level by number. All of those are bound now, alongside the
bindings this already had.

Its block types are on Option and Command together: a maths block on B, a
fence on C, a quote on Q, an ordered list on O, a bullet list on U, a task
list on X and a rule on the minus. Those are bound too. Opening a folder moved
off Option and Command with O, since a menu accelerator wins over the editor's
own keys and a list is made far more often than a folder is opened.

Two of them cannot be written as text. A `<u>` typed into a paragraph is
escaped when the paragraph is saved, because a bare `<` could open anything,
and comes back as `\<u>`; a `$` is escaped for the same reason. Underline
goes in as inline HTML nodes and maths as a maths node, so each is what it
says it is and survives the round trip. Highlight is plain `==`, which needs
no escaping and so can be exactly the characters the file will hold.

## 26. Typora's two writing modes were missing. Closed.

Focus mode and typewriter mode are in Typora's View menu and are part of what
people mean when they say they write in Typora. Focus mode quietens every
block but the one the caret is in; the block is already marked for the syntax
reveal, so knowing which one it is costs nothing, and it recedes rather than
disappearing so the shape of the page is still there to navigate by.
Typewriter mode keeps the line being written at 42% of the way down the pane
and moves the page under it. It only ever acts on a caret, never on a range,
because a page sliding under a drag is unusable, and it moves the page at
once rather than animating, since it runs on every keystroke that changes the
line and an animation would spend its time chasing the last one.

Both are settings, so they are remembered, and both are in the View menu
where Typora keeps them. Neither has a shortcut, which is also Typora's
choice: they are settled once for a session rather than reached for mid
sentence.

## 27. A table could be read but not edited. Closed.

The vault holds 42,330 table rows and there was no way to add one. Tab moved
between cells and stopped at the last; nothing anywhere could insert a row or
a column, delete one, or make a table at all.

Tab at the last cell now makes a row and puts the caret in it, which is what
every table editor does and the only way a table grows without leaving the
keyboard. Typora's own Table submenu is there too, under a Paragraph menu
that also gives the block shapes a home: insert a table, add a row above or
below, add a column before or after, delete a row, a column or the table.

The Paragraph menu closes a second gap. The block bindings taken from Typora
were real but invisible, reachable only by somebody who already knew them.
Every item in that menu runs the same editor command its shortcut runs, so
the two cannot drift apart, and the menu is where a hand goes looking.

## 28. A bracket did not close itself. Closed.

The author's Typora pairs brackets and quotes, which its own settings confirm,
and this did not. Typing an opening bracket now writes its partner and leaves
the caret between them; typing it with something selected wraps the selection;
typing a closing bracket where that same bracket already sits walks past it
rather than doubling it; and a backspace between an empty pair takes both.
The CJK brackets are in the set as well as the ASCII ones, since the notes are
written in Chinese.

The rule that makes it bearable is where it refuses. A quote after a letter is
an apostrophe, so `don't` stays `don't`, and a bracket in front of a word is
nearly always meant as one character. It is a setting, on by default, because
this is the kind of help that is either invisible or infuriating and which of
the two depends on the person.

## 29. There was no menu on a right click, so spell check had no answers. Closed.

Nothing at all came up on a right click, which meant the spell checker could
underline a word and offer nothing to do about it. There is a menu now, built
in main because that is where the clipboard roles and the dictionary's own
suggestions live. It shows only what the click is about: the spelling
section over a misspelled word, with up to five suggestions and a way to add
the word; a link's or a picture's address when the click is on one; and
otherwise the clipboard, including pasting as plain text, which for a file
made of markdown is what is wanted more often than the fragment's own markup.

Pasting itself was already right and had no test. A fragment copied from a web
page arrives as the markdown it means, headings at their own level, bold and
links as marks, lists as lists, and the file it saves has no HTML in it. A
fragment pasted into the middle of a sentence merges with that sentence, which
is what every editor does; on a line of its own the blocks survive.

## 30. Editing a block rewrote more of it than it had to. Closed, in part.

A block nobody touches is copied from the original bytes, but an edited one is
written afresh, and the serializer's dialect is not this vault's. Measured by
parsing and re-serializing every block of 400 notes: 15.2% came back
different. Four causes, worth 6 points between them.

Emphasis was written with an underscore where the vault writes a star, 5,280
to 364. Every underscore in a paragraph was escaped, so any sentence naming
`mcp__claude_api` came back as `mcp\_\_claude\_api`; CommonMark will not
read emphasis from an underscore with a word character on each side, which is
the rule that lets snake_case be written plainly, so an identifier is now
emitted whole. An alert's own `[!TIP]` marker was escaped, which turned the
callout back into a plain quote the first time anybody edited it. And the CJK
emphasis above. Together: 15.2% down to 9.4%.

What is left is deliberate. A rule written as six dashes comes back as three,
a table's cells are padded to their column, and a CRLF file loses one carriage
return at a fence's first line. Each is a normalisation rather than a loss,
and the vault is of two minds about table padding, so there is no form to
prefer.

## 30. A code block had no indent guides. Closed.

`fence-enhance`, which the author runs in Typora, rules a hairline at each tab
stop of a line's indentation, and the vault has 285,431 indented lines across
31,372 fences. They were listed as not ported because each one seemed to need
an element per line, which a document of ten thousand code lines cannot
afford.

It does not. The rules are a gradient carried by the line's own leading
whitespace, which is real text already in the file, so nothing is inserted and
no element is added. The step is the block's own: the common divisor of the
indents it actually uses, so a file indented by three is ruled at three. A line
gets a rule for each step to its left and none at its own, because a rule under
the first character would underline the code rather than mark the step. They
are drawn by the syntax highlighter, which already rebuilds only the block that
changed, so they cost what the highlighting costs and nothing more.

# Faults found on the way

## 31. A plugin enabled last time did not always come back. Closed.

Found through a test that failed about one run in three under load and passed
every time on its own, which is the shape of a race rather than of slowness.
An enabled plugin waits for an editor, and the announcement that one exists
was made from the editor's side only, guarded by a snapshot of the plugin
lifecycle. On a restart those two arrive independently, the editor from
opening the document and the snapshots from main over IPC; whenever the
snapshots were second, nothing ever announced the editor and the plugin sat at
"enabled, waiting for editor" for the life of the window.

The editor now announces if it can and arms a one-shot if it cannot, which the
first snapshot batch of that same startup spends. Deliberately one shot: a
plugin the reader enables later is meant to stay idle until they activate it,
and an announcement left standing would start it the moment it was enabled.

# Where things stand

## Plugins: eight of sixteen, in some form

Real ports: Title Shift, Markdown Padding. Native equivalents: `wider` is the
width modes, `tree-guides` is the connector lines and the sticky folders,
`fuzzy-search` is quick open with content search, `note-assistant` is quick
open's link mode with wiki-link rendering, `fence-enhance` is the fence gutter
with its language, its copy button and its indent guides, and `trail` is back and forward in the
title bar and the Go menu, three notes each way. Not done: `sidenote`,
`timeline`, `todo-manager`, `file-tags`, `code-viewer`, `drawio`, and
`fence-enhance`'s tab markers; `recent-files` exists as a
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
