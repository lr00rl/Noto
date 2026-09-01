# Noto

Noto is a Markdown editor that edits the rendered document and keeps the file
byte for byte. You type into headings, tables, task lists, math and fenced code
directly; there is no separate preview pane and no read-only source island that
you have to leave the document to edit. When you save, every block you did not
touch is written back exactly as it was found, including its line endings and
whatever whitespace it happened to have.

It runs on macOS, Windows and Linux, and it is built with TypeScript, Electron,
React and ProseMirror.

![Noto editing a document, with the file rail open](docs/images/noto-light.png)

<details>
<summary>The same window in the dark theme</summary>

![Noto in the dark theme](docs/images/noto-dark.png)

</details>

## Project status

Noto is usable and under active development. Version 0.1.0 is a first public
release, and the honest summary of where it stands is worth reading before you
depend on it.

What has been verified end to end is macOS, where the packaged application is
driven through its real interface by a Playwright suite on every change. Linux
has been verified once in a clean `node:22` container: install, typecheck, the
unit suite, packaging, and 45 of the packaged tests under `xvfb-run`, which
covers the file identity layer, the workspace, tabs, find and replace, the file
tree, settings, math and the plugin tier. Windows is configured and packages,
and its menu template and platform capabilities are covered by unit tests, but
no packaged Windows build has actually been launched. Treat Windows as
unproven.

The performance story is likewise mixed rather than a clean win, and the
numbers are below.

## Getting started

You need Node 22 and pnpm 11. Newer Node majors are rejected on purpose, since
the packaging path is pinned to the runtime it was verified against.

```sh
pnpm install
node node_modules/electron/install.js   # see the note below
pnpm start
```

The second line fetches Electron's own binary. The published `electron` package
declares a `postinstall` script, but the copy pnpm 11 installs arrives without
a `scripts` field, so nothing runs it and `node_modules/electron/dist` never
appears. Without that directory, packaging fails and the app cannot launch.
`pnpm rebuild electron` does not help, because from pnpm's side there is no
build to run.

## Using it

Open a file with `Cmd+O`, or open a folder with `Cmd+Alt+O` to get the
workspace tree. Documents open in tabs. The rail on the left holds two views,
the file tree and the document outline; the one control at the top left opens
and closes it, and `Cmd+Shift+L` and `Cmd+Shift+O` open it directly on the view
they name. `Cmd+F` finds, `Cmd+Alt+F` finds and replaces, `Cmd+K` opens the
command palette, and `Cmd+,` opens preferences, which is also where plugins are
turned on. On Windows and Linux, read Control for Command.

The title bar carries the filename and nothing else that is not an action you
can take right now: Save appears when there is something to save and is absent
when there is not. What the chrome is for, and why it is this quiet, is written
down in [`docs/design/chrome.md`](docs/design/chrome.md).

`Cmd+/` toggles source mode for the block the caret is in, which is the escape
hatch when you want to see or hand-edit the Markdown behind one paragraph, one
table or one code fence without leaving the rest of the document rendered.

Markdown input rules work as you type: `#` for a heading, `-` for a list,
`` ``` `` for a code fence. The syntax markers for the block you are editing
appear while you are in it and fold away when you leave, so the document stays
readable without hiding what it is made of.

## Byte-exact saving

This is the property the rest of the design is arranged around. Most editors
that render Markdown round-trip it through a serializer, so opening and saving
a file rewrites parts of it you never touched: a list marker changes, emphasis
switches from `_` to `*`, a table's padding is normalized, trailing whitespace
disappears.

Noto parses the file into blocks, records the exact source bytes of each one
along with its origin and hash, and on save writes back the recorded bytes for
every block that was not edited. Only blocks you actually changed are
serialized. A document you open and save without touching is identical to the
byte.

The same block record is what detects an external change: if the file on disk
no longer matches what was accepted, the save is refused and you are offered a
copy rather than an overwrite.

## Performance

Measured against Typora on the same machine, opening the same four generated
documents, with a clock inside each application rather than a stopwatch
outside it. Full method, corpus and failed approaches are in
[`docs/performance/measurements.md`](docs/performance/measurements.md).

| document |     bytes | Noto      | Typora       |
| -------- | --------- | --------- | ------------ |
| small    |    66,061 | 268 ms    | 282 ms       |
| medium   |   524,952 | 903 ms    | 343 ms       |
| large    | 2,097,661 | 4,017 ms  | never loaded |
| huge     | 8,389,427 | 22,467 ms | never loaded |

This is a split result. At 66 KB the two are level. At 525 KB Typora is 2.6
times faster, which is a real gap and not a rounding difference. At 2 MB and
above Typora does not load the document at all: its editor still reports an
empty document after three minutes, which was checked three separate ways
before being written down. So Noto opens files Typora will not open, and Typora
opens mid-sized files faster than Noto does.

Profiling says where Noto's time goes, and corrects the obvious guess. Opening
currently parses the document twice, once in the main process to establish the
block records and once in the renderer to build the editor document. Building
the ProseMirror document from the parsed nodes is free, 4 ms for 2,742 blocks,
so there is no win hiding in the editor's node construction. The entire cost is
the Markdown parse itself. Removing the duplicate would take roughly 330 ms off
the 903 ms and land near 570 ms, still behind Typora's 343 ms, so closing that
gap needs the parse to leave the critical path or get cheaper per byte rather
than merely to happen once.

## Plugins

Plugins are explicit: each one declares the capabilities it wants, and the main
process brokers every one of them. A renderer plugin can decorate or transform
the document only if it asked for that; a service plugin gets a filesystem
grant scoped to a path, revocable, and denied everywhere else. Nothing is
ambient.

Four plugins ship in the build. Title Shift promotes and demotes heading
levels, and Markdown Padding applies CJK spacing rules; both are ports of the
author's Typora plugins. Semantic Focus and Fixture Reader are bundled
examples, one per runtime kind, kept so that a plugin author has a working
plugin of each shape to read and so the capability broker has something that
exercises it.

## Building and verifying

```sh
pnpm verify          # typecheck and the unit suite
pnpm package:e2e     # package the variant the end-to-end suite drives
pnpm test:e2e        # run that suite against the packaged app
pnpm make:release    # installers for the host platform
```

`pnpm make:release` produces a zip on macOS, a Squirrel installer on Windows,
and deb and rpm packages on Linux. Signing is read from the environment, so an
unsigned local build and a signed release build take the same path: set
`NOTO_APPLE_SIGNING_IDENTITY`, and `APPLE_ID`, `APPLE_PASSWORD` and
`APPLE_TEAM_ID` to notarize, or `WINDOWS_CERTIFICATE_FILE` and
`WINDOWS_CERTIFICATE_PASSWORD` on Windows. With none of them set the build
still succeeds and is simply unsigned, which is what a contributor without
certificates needs.

The end-to-end suite runs against a packaged application rather than a
development server, because the things most likely to break in an Electron app
are exactly the things a development server does not exercise: the preload
bridge, the fuses, what is inside the asar, and the application menu.

## How it is put together

The main process owns the file: reading, block records, saving, recovery, the
workspace, recent files and settings. The renderer owns the editor and never
touches the filesystem. A separate service process handles plugin filesystem
access, so a plugin's file reads are not running inside the window. The preload
bridge exposes four narrow, versioned APIs and validates every message on both
sides.

The Markdown pipeline is `micromark` and `mdast` with GFM, math and frontmatter
extensions, mapped onto a ProseMirror schema that keeps each block's original
source alongside its rendered form. That mapping is what makes both byte-exact
saving and per-block source mode possible from one representation.

Further reading lives in `docs/`: the performance measurements, the Linux
verification record, and a review of what the release build asks the operating
system for.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

Third-party dependency licenses are inventoried in
`resources/provenance/THIRD_PARTY_NOTICES.md`, regenerated with
`pnpm license:inventory`.

Typora is a behavior reference only. Noto contains no Typora code, markup,
assets, strings, themes or private protocols.
