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
