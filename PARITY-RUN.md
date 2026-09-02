# Typora parity run, 2026-09-02

A standing task: bring Noto's editing experience and interface as close to the
author's Typora as they can be got, working from the author's own vault
(`~/roobli/Nut/RooB`, 7,066 notes) and the author's theme
(`~/roobli/lr00rl/Typora_Claude-Like_Theme/claude-like.css`). Runs until
19:00 PDT. No questions: a decision that needs making goes to a subagent.

## The instrument

Typora is driven live through the remote control plugin
(`~/roobli/lr00rl/typora-plugin-lite`), sidecar on `127.0.0.1:5619`:

    node ~/.claude/skills/typora-remote/scripts/typora-remote-cli.mjs info
    node ~/.claude/skills/typora-remote/scripts/typora-remote-cli.mjs call typora.eval '{"code":"..."}'

`typora.eval` runs JS in Typora's renderer, so any computed style, box or
scroll position can be measured rather than guessed. Noto is measured the
same way through a packaged Playwright driver
(`scratchpad/same-note.mjs <note> <name> <w> <h> <anchor>`).

Window capture: `screencapture -x -o -l <yabai window id>`.

## Order of work

Each item is: measure Typora, measure Noto, close the gap, render both, commit.

1. Instrument. Remote control must survive multiple windows and reconnect.
2. Headings and lists at the top of a note.
3. A fence: gutter, language, copy, scroll.
4. Images and their captions.
5. The outline pane.
6. Quick open, preferences, menus.
7. Caret, selection, focus mode, typewriter mode.
8. Interaction: what happens on click, drag, hover, keyboard.

## State

See `docs/design/typora-gap.md` for what is closed and how. Every slice is a
branch, verified (`pnpm typecheck`, `CI=true pnpm test`,
`CI=true pnpm package:e2e` then `CI=true pnpm exec playwright test`), merged
`--no-ff` into main, pushed.

## The probe

`scratchpad/probe/` holds the instrument this run is built on. It asks both
editors the same question and diffs the answers, so a gap is a number rather
than an impression.

    node probe/measure-typora.mjs <note.md> <w> <h> out.json   # through the sidecar
    node probe/measure-noto.mjs   <note.md> <w> <h> out.json   # through the packaged app
    node probe/diff.mjs typora.json noto.json                  # only what differs

`kitchen-sink.md` is one note holding every construct. `map.json` names the
selectors; `chrome-map.json` and `chrome-map-noto.json` do the same for the
window furniture. `shot-noto.mjs` renders Noto at a given size and rail width.

Typora is driven with one window open, since several windows share one
sidecar session and the claim does not follow focus in its WebView.

## What this run did

Worked through in order, each slice verified and merged on its own branch.

The instrument first: the remote control plugin kept one Typora session and
forgot it the moment that socket closed, and it started its sidecar with no
parent to watch, so the process outlived every Typora it served. Fixed in the
author's own plugin repository, which made live measurement possible.

Then measurement rather than impression. Both editors were asked the same
question at the same window size and their answers diffed field by field: the
type scale already matched, and what differed was a reading column 64px too
wide, three near-miss colours, code painted in status colours instead of the
theme's five, a tree a size smaller and a third tighter than Typora's, and a
page whose gutters were short at both ends.

Then the things Typora does that this did not: its keys for the marks
markdown has no key for, its block types on Option and Command, focus mode and
typewriter mode, table editing, closing a bracket as it is opened, a menu on a
right click, indent guides in code.

Then the vault itself, which found the largest faults. Bold beside Chinese was
not bold, in a quarter of the files. Editing a paragraph escaped every
underscore in an identifier, turned an alert's marker into plain text, and
wrapped bare URLs in angle brackets. Re-serializing every block of 400 notes
put a number on it: 15.2% of blocks came back different, now 9.4%, and what
remains is normalisation rather than loss.

Speed was measured, not assumed: `docs/performance/large-documents.md`.

Where the record lives: `docs/design/typora-gap.md` for what was found and
what was done, `docs/design/chrome.md` for the window, `docs/theming.md` for
what a theme can reach.

## The afternoon: driving the product instead of reading it

The corpus measurement had been the best instrument all morning and it ran
out of road. What replaced it was cruder and found more: copy a real note,
open it in the packaged application, type one letter into a block, save, read
the file back, and check that every line the reader did not touch survives.
It lives in `scripts/edit-sweep.mjs` and it covers a paragraph, a heading, a
list item, a table cell, a line of code and a line inside a quote.

It found the worst fault of the day on its first run. A paragraph the author
wrapped by hand holds newlines, and the editor drew them correctly but
collapsed them to spaces the moment it read its own DOM back after a
keystroke. One letter joined every line of the paragraph. 5,339 of the 7,047
notes have such a paragraph, 341,174 of them in all. Headings had the same
fault through setext underlines, 2,963 notes more. The flag that fixes it is
`whitespace` on the node spec, not `preserveWhitespace` on the parse rule,
which is worth writing down because the wrong one changes nothing and looks
right.

The same technique found a link with a bold word in it splitting into two
links on save, 1,491 of those in the vault.

What was added, each read out of the running Typora rather than remembered:
the hyperlink panel and following a link, which the vault wanted most at
14,417 inline links; the rails a table is taken hold of by; moving a line, a
row, a column or a block; callouts; a Format menu; the word count; making a
note at all, which the File menu could not do; and copying as markdown, which
the author's Typora does by default.

Three independent reviews at the end found four more, two of which the
testing had already closed, and one that was wrong on reading the code.

Speed with all of it on the author's largest note, 2.95 MB and 10,937 blocks:
1.6 seconds to open, 51 milliseconds a keystroke.
