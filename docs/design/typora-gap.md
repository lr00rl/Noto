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

Tables were the next largest and are now mostly closed. The serializer padded
every cell out to its column's width and shortened each delimiter cell to a
single dash; the vault does neither, writing two thirds of its 43,076 table
rows unpadded and 4,039 of its delimiter rows with three dashes. Padding is
off and the delimiter cells are widened back, colons kept where they were.
Table churn fell by 44%, and the total from 9.4% to 8.7%.

A third pass took it to 7.3%, and is written up below.

## 31. A code block had no indent guides. Closed.

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

## 32. A plugin enabled last time did not always come back. Closed.

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

## 33. The shell would open anything, and draw it as prose. Closed.

The tree lists Markdown and plain text, the search index holds the same, and
the Open dialog filters to it. The command line took whatever it was given, so
`Noto main.ts` opened a source file and drew it as prose: the indentation
gone, a template literal read as a code span, and any block the reader touched
written back as markdown rather than as the code it is.

The four now give the same answer, from one list rather than the two copies
that each carried a comment saying they had to match. Opening something else
says what the editor is for instead of quietly making a mess of the file.

## 34. Opened against the vault, note by note. Nothing broke.

220 notes spread across the whole vault were opened one after another in a
packaged window, with every console error collected and every render compared
against the file's own length. Four notes reported a problem and all four were
the same thing: an image whose remote address no longer answers, which the
editor draws as a labelled frame carrying the note's alt text and the reason.
No note failed to open, none rendered empty, and none lost its content.

The script is `scratchpad/probe/sweep.mjs`, and it is worth running again after
any change to the parser or the editor's plugins: it exercises constructs no
made-up document contains.

## 35. A note was written back in a dialect its author does not use. Closed.

Three findings from the same corpus measurement, taking it from 8.7% to 7.3%.

A paragraph opening with a highlight had its first `=` escaped, because an `=`
at the start of a line can underline a setext heading. `\==text==` is not a
highlight any more, so the feature broke itself the first time anybody saved.

A hard break was written as a backslash. The vault ends a line with two spaces
16,328 times and with a backslash 237 times, so editing one paragraph of an old
note rewrote every break in it into a form the file has never used. Both mean
the same thing to every parser here, so the file's own convention wins. Inside
a setext heading or a table cell, where no newline can go, the break still
degrades to a space.

The carriage returns were a false alarm. The pipeline works in LF and the
writer restores the file's own endings, which the measurement was not
accounting for; a packaged test now drives the real app against a CRLF note and
reads the file back. What remains is mostly a block written in a style of its
own, a rule of six dashes or an aligned delimiter row, and those are only ever
rewritten if the block itself is edited. A test covers a neighbouring edit
leaving both untouched.

## 36. There was no way to move a line, a row or a block. Closed.

Typora puts three behaviours on Option and an arrow, and which one you get
depends on where the caret is: a line of code moves inside its fence, a row
moves inside its table, and anywhere else the block itself moves among its
siblings. When a block has no sibling on that side the move is tried again on
its parent, so the last item of a list carries the whole list with it. Columns
move left and right on Command, Control and an arrow. The bindings are read
from the running Typora rather than remembered: `alt+up`, `alt+down`,
`command+control+left`, `command+control+right`.

A table's first row is its header, and markdown cannot write a table without
one, so the header stays where it is and no row moves above it. One difference
is deliberate: Typora stops at the line inside a fence, which leaves a fence
with nothing above it stuck where it is, while here the move carries on to the
block. The intent behind the key is the same either way.

## 37. A table could only be rearranged from the menu. Closed.

Typora grows a slim rail above the columns and beside the rows when the pointer
is over a table. The rail was found by reading the running app rather than from
memory: `#typora-table-row-tracker` and `#typora-table-col-tracker`, each with a
drag area and a data area, and `#typora-table-row-insert-marker` beside them.
Typora fills the tracker with a clone of the row so the row itself follows the
pointer.

Noto draws the same rail, one handle per track, quiet until the table is under
the pointer. Clicking a handle selects its row or column; dragging carries it,
with a line in the accent colour showing where it will land, and Escape or a
cancelled pointer puts everything back because nothing is dispatched until the
drop. The header has no handle and nothing may pass above it.

Two things were learned building it. Handles drawn to the full length of their
track join into one continuous bar and stop reading as one grip per column, so
each is inset three pixels at both ends. And anything written to the node view's
own element, `data-dragging` in the first attempt, is a change the editor did
not make: it rebuilds the view and the drag dies on the first pointer move.
Everything the drag touches now lives inside the rails, which the view is told
to ignore.

## 38. Every window, looked at rather than reasoned about. Three faults.

Preferences, quick open, the plugin centre, find and the empty state were
opened and photographed at 1280 by 820 in both themes. Three things were
wrong, and all three were only visible in a picture.

Opening a note from Finder left the workspace with no folder, so the tree was
empty and quick open said there was nothing to search while sitting in a
directory full of notes. That is written up above.

The find bar reserved five and a half characters for a match count that never
needs more than "No results", and closed with a button filled in the ink
colour, which made the loudest thing in the window the one control that is not
the reason the bar is open. Escape closes it anyway. The count now reserves
what it needs and the button reads as one more control.

The two buttons on the empty state sat at different heights, because the
primary carried a top margin of its own inside a centred row. Both now take
their shape from one rule and only the colours differ.

A fourth came out of photographing the same windows in the dark theme.
Preferences and quick open were drawn in the paper colour on a ground that was
the paper colour under a scrim, which in the light theme is a pale card on a
grey field and in the dark theme is two nearly identical dark greys: 0x1F1E1C
against roughly 0x0F0E0D, with a black shadow contributing nothing. A panel
over a scrim now has its own token and is lifted above the page in the dark
rather than matched to it. The find bar keeps the raised colour, because it
floats without a scrim and has to differ from the page it sits on. The two
cases look like one and are not.

## 39. There was no way to make a link, or to change one. Closed.

Typora's menu was read out of its own bundle, 301 labels, and set beside
Noto's. Most of what it has that Noto does not is export, printing and
document conversion. One entry was not like the others: Hyperlink, on Command
and K, which Noto had no command for at all, on any menu or key. Making a link
is among the most common things anybody does in markdown.

Worse, an existing link could not be changed either. The delimiters revealed
around the caret show a link's destination because it is the part a reader
cannot otherwise see, but they are decorations and nobody can type into a
decoration, so the only way to correct an address was to leave for source mode.

Command and K now opens a small panel under the link. With text selected it
makes one; with the caret in a link it opens on that link and shows its
address; Enter writes, Escape and clicking away leave the file alone because
nothing is dispatched until then, and Remove takes the link off and keeps the
words. It declines inside a fence, which holds its text as literal source and
takes no marks.

Three things about the panel were only findable by driving it. `display: flex`
outranks the browser's own rule for the hidden attribute, so the panel was
never actually hidden. A command run from the menu focuses the editor again as
soon as it returns, which blurred the field, and blurring is the dismissal, so
the panel opened and shut in the same tick; the field now takes focus on the
next frame. And pressing Remove blurred the field before the click landed, so
by the time the button's handler ran there was nothing left to act on; a press
inside the panel no longer moves focus.

## 40. The revealed delimiters were lying about the file. Closed.

The reveal showed `_` for emphasis while a save wrote `*`, ever since the
serializer moved to the star the vault actually uses. There was a test for
exactly this, and it passed the whole time, because it asserted the characters
against themselves rather than against a save. Two places naming the same
constant agreed with each other and not with the document.

The reveal now takes the characters from the serializer, and the test
serializes a document with each mark and compares. The selection colour went
the same way: it was set inside the editor only, so every field outside it
selected in the platform's blue on a warm page.

## 41. Bold and italic had keys and no menu. Closed.

The same reading of Typora's menu turned up a plainer gap than the missing
hyperlink. Typora keeps Paragraph for the block a thing is and Format for how
its words are drawn. Noto had no Format menu at all: Strong, Emphasis, Code
and Strike existed only as key bindings, so the only way to learn them was to
already know them, and Underline, Highlight and Inline Math sat at the foot of
Paragraph where they are not.

There is a Format menu now, with all seven, the hyperlink, and Clear Format,
which takes every inline mark off the selection and leaves the words. Block
type is not touched by it: a heading that stopped being a heading would be a
different command.

## 42. Not one of the vault's 14,417 links could be followed. Closed.

Counting what the vault actually holds put the earlier guesswork right.
Inline links come to 14,417, tables to 1,123 files, callouts to 105 and
footnotes to 53. Links are the thing this vault is made of, and clicking one
did nothing at all: the window refuses navigation, which is the right refusal
and the wrong end state.

Command or Control and a click follows one now, the same modifier a wiki link
already took, because the text under a link is editable text and a plain click
has to go on placing the caret. A page on the web goes to the browser; any
other address is treated as a note in this folder and resolved the way a wiki
link is, by relative path and then by name.

Reaching the browser means `shell.openExternal`, which hands the string to the
operating system and will launch a handler for any scheme the machine knows,
and the string came out of somebody's Markdown file. The scheme is checked
against http, https and mailto in the renderer, in the preload, and again in
main immediately before the call.

The check that mattered was not the third one. Validating a parsed URL and then
opening the raw string is a bug wherever the two parsers disagree, and they do:
`https:/\/\evil.com` parses here as `https://evil.com/`, a tab inside a host
is dropped, a newline inside a scheme is dropped. Only the normalised form is
opened, so what was checked is what is launched.

## 43. A note never said how long it was. Closed, with a difference.

Typora keeps a word count and puts it behind a popover. Noto's status line
had the folder path and a promise about fidelity and nothing about the note
itself. The count now sits at the end of that line, where nothing competes
with it.

It is counted from what the document draws, never from the file. One of the
author's notes is 910 bytes of which most is image addresses; counting the
file says 144 words and counting the document says 84. Typora agrees with the
principle here: it reports far less than the file holds too.

It is counted after typing stops, not during. A megabyte of prose takes about
37 milliseconds, which is nothing to wait for after a pause and far too much
to pay for a letter. Typora does the same, on a deferred timer of its own.

The rule is a run of letters or digits for one word, and a Han character, a
kana or a Hangul syllable for one word each, because Chinese and Japanese put
no spaces between words and counting runs would report one word per sentence.

This does not match Typora and is not meant to. On that same note Typora says
112 where this says 84. The note holds 81 Han characters, three hyphenated
Latin words and fifteen pieces of Chinese punctuation, and Typora appears to
be counting the punctuation. A full stop is not a word. Parity is the goal
everywhere it describes something a reader wanted; here it would mean copying
a number that is wrong.

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
