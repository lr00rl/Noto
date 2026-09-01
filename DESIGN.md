# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-28
- Primary product surfaces: Electron desktop app shell, workspace sidebar, Milkdown document canvas, command palette and search, operational status, Plugin Center, capability prompts, settings, and conflict/recovery surfaces
- Current milestone: `G001-electron-milkdown-plugin-spike`
- Canonical G001 handoff: `.omx/handoff/g001-electron-design-spec.md`
- Evidence reviewed:
  - `.omx/ultragoal/brief.md`
  - `.omx/ultragoal/goals.json`
  - `.omx/handoff/electron-ultragoal-plan-review.md`
  - `/Users/cdcd/roobli/lr00rl/roob-site/quartz/styles/claude-like-tokens.scss`
  - shell, layout, and search rules in `/Users/cdcd/roobli/lr00rl/roob-site/quartz/styles/custom.scss`
  - `/Users/cdcd/roobli/lr00rl/typora-plugin-lite/DESIGN.md`
  - `/Users/cdcd/roobli/lr00rl/typora-plugin-lite/packages/core/src/editor/api.ts`
  - `/Users/cdcd/roobli/lr00rl/typora-plugin-lite/packages/core/src/plugin/manifest.ts`
- Observed evidence:
  - The active Ultragoal explicitly replaces AppKit, WKWebView, and CodeMirror-primary editing with Electron, React, TypeScript, SCSS, and Milkdown on ProseMirror and Remark.
  - G001 is an executable go/no-go spike. It must open, edit, save, quit, relaunch, and reopen a real Markdown file while preserving untouched bytes and an opaque unsupported block.
  - RooB already defines the required independent warm-paper and warm-charcoal palettes, CJK-first serif prose, quiet sans-serif UI, monospace source roles, and a single-panel quick-open pattern.
  - `typora-plugin-lite` provides useful lifecycle, command, settings, hotkey, search, stale-result, and confirmed-success concepts, but its editor API depends on Typora private globals and its manifest does not yet express Noto runtime tiers or capabilities.
  - The existing design contract described the rejected AppKit, WKWebView, and CodeMirror-primary direction and could not remain alongside the active Electron plan.
- Assumptions to validate in G001:
  - Milkdown and ProseMirror can provide stable Chinese and English daily editing, semantic block activation, exact selection mapping, and opaque unsupported nodes behind a Noto-owned adapter.
  - The selected CJK font stacks have acceptable metrics across the supported desktop hosts.
  - A compact layout near 900 by 700 can preserve the current document while the workspace sidebar collapses and consequential prompts remain usable.
  - An Electron utility process can isolate a privileged service plugin, report denial and crash states precisely, and recover without making the renderer privileged.

## Brand

- Personality: quiet, editorial, precise, local-first, and technically trustworthy
- Intended emotion: calm concentration with clear operational confidence
- Trust signals:
  - the visible document is a real local Markdown file
  - dirty state appears immediately after an edit
  - saved state appears only after the atomic write, semantic validation, and accepted file identity are confirmed; fresh-process reopen remains separate G001 acceptance evidence
  - unsupported syntax stays visible and preserved
  - plugin runtime tier, granted capability, failure, and recovery are legible
- Avoid:
  - generic code-editor chrome, raw Markdown as the default, split preview, and a second document canvas
  - card-dashboard layouts, oversized whitespace, decorative gradients, glass, blur garnish, paper texture, fake terminals, and copied Typora assets or strings
  - any surface that looks loaded, saved, granted, or recovered after a sub-operation failed

## Product goals

- Goals:
  - let an expert technical writer open a real local Markdown file and start writing immediately in one beautiful rendered canvas
  - preserve exact file identity, untouched byte slices, opaque syntax, selection intent, and confirmed save/reopen state
  - make local workspace navigation, search, and commands fast enough for long daily Chinese and English sessions
  - make plugins and capability grants day-one product surfaces with visible trust boundaries and truthful failure semantics
  - preserve standard Markdown portability while hiding Milkdown, ProseMirror, Remark, Electron, and plugin-host implementation details behind Noto-owned adapters
- Non-goals for G001:
  - cloud sync, accounts, collaboration, publishing, mobile, browser, or PWA delivery
  - a public plugin marketplace, untrusted third-party renderer execution, automatic plugin download, or final plugin signing infrastructure
  - perfect semantic editing for every Markdown extension
  - Tauri, AppKit, WKWebView, Swift bridges, or CodeMirror as the primary shell or editor
  - complete Windows and Linux visual certification, although platform boundaries must remain explicit
- Success signals:
  - open, edit, save, quit, relaunch, and reopen succeeds against a real fixture and path
  - untouched source slices and the file envelope remain byte-identical; the edited block reparses to the expected meaning
  - an unsupported block remains explicit and opaque rather than disappearing or being normalized
  - one trusted renderer plugin and one isolated service plugin run through declared manifests and grants; a denial and a load or crash failure remain visibly unsuccessful
  - real Electron screenshots pass the G001 wide, compact, light, dark, focus, state, overflow, and accessibility review

## Personas and jobs

- Primary persona: the owner, an expert technical writer who uses the app for long daily Chinese and English Markdown sessions and maintains local knowledge bases
- User jobs:
  - open a known file, recent file, or workspace result in one or two actions
  - read and edit a polished rendered document without switching to a permanent source view
  - reveal exact Markdown only around the semantic unit that currently needs source-level intent
  - know immediately whether the document is dirty, saving, saved, conflicted, failed, or recoverable
  - run plugin commands and understand what a plugin can access, where that access applies, and what happens if it is denied or crashes
- Key contexts of use:
  - hours-long focused writing with keyboard, pointer, Chinese IME, selection, undo, and search
  - mixed CJK and Latin prose with code, tables, math, images, and opaque project syntax
  - resizable desktop windows and compact laptop layouts
  - private local files, intermittent plugin failures, external file changes, and interrupted saves

## Information architecture

- User-facing objects:
  - workspace
  - document
  - semantic block
  - source slice
  - selection
  - save checkpoint
  - plugin
  - capability grant
  - command
  - recovery record
- Primary navigation:
  - a stable compact left workspace/sidebar when space permits
  - the central document canvas as the persistent primary destination
  - keyboard-first command palette and workspace search as first-class entry points
  - quiet inline or bottom operational status
  - Plugin Center and settings one level deeper than the writing surface
- Core surfaces:
  - app shell and current document
  - workspace tree and recent files
  - command palette and search results
  - Plugin Center and capability details
  - settings
  - error, conflict, and recovery surfaces
- Content hierarchy:
  1. current document and selection
  2. current file identity and operational truth
  3. frequent navigation and commands
  4. contextual plugin and source actions
  5. settings, diagnostics, and recovery history
- IA rule: internal APIs, IPC endpoints, plugin processes, and editor-vendor concepts do not become top-level destinations. Runtime tier appears only where trust, permission, failure, or recovery makes it relevant.
- Primary path: open file -> rendered single canvas -> edit -> immediate dirty acknowledgement -> save -> exact confirmed state -> quit and reopen
- Critical alternate paths:
  - unsupported or opaque syntax remains visible, preserved, and locally editable through an explicit source boundary
  - permission denial leaves the feature unavailable and names the denied object and scope
  - plugin load failure or service crash leaves the plugin visibly failed or stopped while the core document remains safe
  - external change pauses save and offers explicit version choices
  - save failure keeps the document dirty and offers retry or save-copy recovery
  - conflict and recovery never show a clean saved state until the selected resolution is confirmed

## Design principles

- One real document, one primary canvas: Milkdown and ProseMirror own normal rendered editing. Split preview and permanent raw Markdown are prohibited.
- File truth outranks surface calm: every dirty, save, external-change, conflict, recovery, permission, and plugin state is explicit even when it interrupts the ideal composition.
- Source appears only at intent: exact markers or a source slice appear only around the active semantic unit or inside a deliberate source-mode boundary.
- Plugins are product objects: install state, runtime tier, declared capability, grant scope, health, and recovery are designed from G001.
- Capability at the feature moment: prompts name the plugin, object, scope, and consequence when the feature is invoked, not during speculative startup.
- Stable muscle memory: typing, caret movement, selection, search, command execution, undo, redo, and marker reveal are immediate and unanimated.
- Common before advanced: opening, finding, editing, and saving take one or two actions; plugins, settings, source mode, diagnostics, and recovery remain predictable but one level deeper.
- Tradeoffs:
  - preserving user bytes and showing a failure outrank keeping the canvas visually quiet
  - daily editing speed and legibility outrank decorative novelty
  - progressive disclosure outranks hiding advanced capability or exposing implementation architecture

## Visual language

- Chassis: an editorial reading surface inside a compact daily-tool shell
- Evidence: the real Markdown document, source identity, selection, save checkpoint, plugin tier, capability scope, and actual operational states
- Accent: the restrained RooB terracotta active semantic block intent cue, and nothing else decorative
- Signature element: a 1 to 2 px side or inset accent on the active semantic block. It does not move text, add a caret stop, change line height, or animate during typing. Source markers appear only around that active semantic unit where editing requires them.
- Light palette, exactly six primary values:

  | Name | Value | Role |
  | --- | --- | --- |
  | Paper | `#FAF9F6` | document canvas |
  | Panel | `#F3F1EC` | workspace/sidebar and quiet shell regions |
  | Raised | `#F2F1EE` | code, source slice, selected row, and nested operational surfaces |
  | Ink | `#34312E` | prose, headings, controls, and high-confidence state |
  | Hairline | `#DDD9D2` | separators, input boundaries, and structural focus support |
  | Accent | `#A85D3B` | active semantic block intent cue only |

  Muted text may use the RooB semantic derivative `#6F6B66`. Existing semantic success, warning, and danger token families may express real status, but they are not decorative accents.
- Dark palette, independently authored rather than inverted:

  | Name | Value | Role |
  | --- | --- | --- |
  | Paper | `#1F1E1C` | document canvas |
  | Panel | `#181715` | workspace/sidebar and quiet shell regions |
  | Raised | `#292826` | code, source slice, selected row, and nested operational surfaces |
  | Ink | `#D7D4CF` | prose, headings, controls, and high-confidence state |
  | Hairline | `#3B3935` | separators, input boundaries, and structural focus support |
  | Accent | `#E0A07A` | active semantic block intent cue only |

  Strong and muted roles may use the existing RooB `--ink-strong-color` and `--ink-muted-color` derivatives.
- Typography:
  - document prose and headings: `"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif`
  - UI: `"PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif`
  - code, paths, IDs, and revealed markers: `Menlo, Monaco, "SF Mono", Consolas, monospace`
  - document body: 18 px at roomy widths, 17 px when compact, about 1.6 line-height
  - reading measure: about 760 to 860 px depending on the sidebar, optional detail surface, and available window width
- Spacing and geometry:
  - 4 px base rhythm
  - 32 px document padding at roomy widths, 24 px at compact widths, with 20 px permitted only when the available content width is constrained
  - flat connected regions with hairline separation; modest 3 to 6 px radii only where control grouping needs them
  - no card wall, simulated paper sheet, decorative shadow stack, gradient, texture, blur, or glass
- Motion:
  - no animation for typing, caret, selection, command palette, search navigation, undo, redo, or marker reveal
  - occasional dialogs and notices may use 125 to 200 ms transform and opacity transitions
  - reduced motion removes those transitions without removing acknowledgement or focus movement
- Wide wireframe, approximately 1440 by 900:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ title/path                         document state                window tools │
├────────────────┬───────────────────────────────────────┬─────────────────────┤
│ Workspace      │                                       │ Plugin/permission   │
│ Search         │         one rendered document         │ detail when opened  │
│                │                                       │                     │
│ folders/files  │     active block has one inset cue    │ tier, scope, effect │
│ recent         │     source only at active intent      │ Allow / Deny        │
│                │                                       │                     │
│                │        760 to 860 px measure          │                     │
├────────────────┴───────────────────────────────────────┴─────────────────────┤
│ file identity  |  Unsaved changes / Saving / Saved / Conflict / Recovery    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Compact wireframe, approximately 900 by 700:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Files  title/path                     state                    Commands/Search│
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                    one rendered document canvas                              │
│                    20 to 24 px outer padding                                 │
│                    active block cue never moves text                         │
│                                                                              │
│  workspace opens as a non-displacing overlay; permission/plugin detail       │
│  opens as a bounded consequential surface and preserves the document state   │
├──────────────────────────────────────────────────────────────────────────────┤
│ exact file and operational state; errors remain visible and actionable       │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Components

- Existing concepts to adapt:
  - RooB semantic SCSS tokens and CJK-first typography
  - the proven single-panel quick-open pattern with dense filename/path rows, natural result height, backend-consistent ordering, and no preview-card stack
  - `typora-plugin-lite` lifecycle, command, setting, hotkey, queueing, stale-result, and confirmed-success behavior, without Typora private host dependencies
- New or changed components:
  - App shell
  - Workspace tree
  - Document canvas
  - Active semantic block
  - Source-mode boundary
  - Command palette and search
  - Operational status
  - Plugin Center
  - Capability prompt
  - Error and recovery surface
  - Settings
  - Notices
- Variants and states:
  - every material interactive surface covers default, hover where relevant, focus-visible, pressed, selected, disabled or unavailable, loading or pending, empty, success, error, permission-denied, plugin-crashed, conflict, recovery, and long-content or overflow where applicable
  - selected rows use Raised plus Ink and do not consume Accent
  - trusted renderer access is labeled as an editor extension; isolated privileged access is labeled as a service extension
  - service failure never changes the core document into a failed editor state unless the document operation itself depended on that service
- Token and component ownership:
  - Noto owns semantic tokens, editor adapter types, IPC schemas, focus contracts, state vocabulary, and plugin chrome
  - Milkdown, ProseMirror, Remark, CodeMirror, and Electron types stay behind Noto-owned adapters
  - plugins consume documented tokens and extension points and cannot target private application structure

## Accessibility

- Target standard: WCAG 2.2 AA where the Electron web surface permits, plus platform accessibility behavior for desktop menus, dialogs, and windows
- Keyboard and focus:
  - all common paths work by keyboard; command palette and search are primary keyboard surfaces
  - focus-visible is high contrast, unobscured, and independent of the Accent color
  - dialogs trap focus only while a consequential decision is open, close on Escape when safe, and restore the invoking control
  - the compact workspace overlay preserves document caret, selection, and scroll and does not trap the document after dismissal
- Semantics:
  - use native web elements and behavior before ARIA
  - trees, dialogs, lists, options, tabs, statuses, progress, and error summaries expose name, role, value, selection, and state
  - dirty, saved, failed, denied, crashed, conflict, and recovery changes use concise live-region announcements without repeating every keystroke
- Readability:
  - body, muted text, focus, selection, borders, and semantic states meet contrast requirements in light and dark modes
  - 200 percent text zoom reflows without clipping the command palette, permission prompt, plugin detail, status, paths, or document content
  - long paths and IDs wrap or shorten visually while the full accessible name remains available
- Reduced motion and sensory considerations:
  - no core meaning depends only on color, motion, hover, sound, or drag
  - reduced motion removes occasional dialog and notice transitions

## Responsive behavior

- Supported contexts: resizable desktop content regions, validated first near 1440 by 900 and 900 by 700
- Layout decisions use available content width, not device names:
  - when the shell can preserve the compact sidebar, document measure, and required gutters, the sidebar remains visible
  - below that capacity, the sidebar collapses into a non-displacing overlay and the current document retains its caret, selection, scroll, and measure
  - a plugin or permission detail may sit beside the canvas only while at least 760 px of document measure remains; otherwise it becomes a bounded overlay
- Wide layout:
  - compact sidebar around 224 px
  - document measure grows only to about 860 px
  - optional detail surface around 320 to 360 px
- Compact layout:
  - document padding reduces from 32 px to 24 px, then no lower than 20 px
  - workspace access stays visible in the top shell
  - wide tables and long code scroll inside their semantic block rather than causing page-level horizontal scrolling
- Pointer and keyboard remain primary. Hover is enhancement only and every hover action has a focus and keyboard equivalent.

## Interaction states

- Loading or pending: show the existing shell and document identity; name the operation, preserve input where safe, and reject stale results
- Empty: distinguish no workspace, empty document, no search result, no plugins, and no recovery record; give the next useful action
- Dirty: acknowledge immediately after the first accepted edit and remain dirty through a failed or conflicted save
- Success: announce saved, loaded, granted, or recovered only after the responsible process confirms the exact operation
- Error: state what happened, what remains safe, and the next action
- Permission denied: name the plugin, requested object, scope, and unavailable feature; denial is not a transient success toast
- Plugin crashed: mark the affected plugin or service stopped, keep unrelated editing available, and offer `Retry plugin`
- External change and conflict: pause overwrite, preserve both known versions or a recovery copy, and offer explicit version actions such as `Keep external version`
- Recovery: identify the recovery record, source path, timestamp, and consequence of restore or discard; restoration remains pending until confirmed
- Disabled or unavailable: explain why the command or feature cannot run and what condition would enable it
- Long content and overflow: preserve primary names, source identity, and action labels; shorten middle path segments visually, contain table/code scrolling, and keep overlays inside the viewport
- High-frequency interactions: typing, caret, selection, search navigation, command palette navigation, undo, redo, and marker reveal have no animation and no delayed acknowledgement

## Content voice

- Tone: direct, calm, specific, and operational
- Terminology:
  - use workspace, document, semantic block, source slice, selection, save checkpoint, plugin, capability grant, command, and recovery record consistently
  - use editor extension for trusted DOM or editor-adapter access
  - use service extension for isolated filesystem, shell, network, or remote-control access
- Microcopy rules:
  - use outcome labels such as `Save document`, `Retry plugin`, `Allow read access to <folder>`, and `Keep external version`
  - permission copy names object, scope, and consequence before the action
  - errors say what happened, what remains safe, and the next action
  - never use `Done`, `Success`, or `Loaded` when only part of the operation completed

## Implementation constraints

- Framework and styling:
  - Electron main, preload, renderer, and utility-process boundaries
  - Vite, React, TypeScript, and SCSS in the renderer
  - Milkdown on ProseMirror and Remark as the primary editor behind a Noto-owned adapter
  - CodeMirror only for deliberate full-source mode and code-block node views
  - no AppKit, WKWebView, Swift bridge, Tauri, Tailwind, or shadcn foundation
- Security and plugin boundaries:
  - `contextIsolation` is on and renderer Node integration is off
  - preload exposes a narrow typed and versioned IPC surface
  - trusted renderer plugins receive only declared DOM or editor-adapter capabilities
  - privileged service plugins run in an isolated utility process and receive only granted filesystem, shell, network, or remote-control capabilities through validated messages
  - Plugin Center exposes grant review and revocation; the renderer never obtains ambient filesystem or process authority
- Source and save constraints:
  - the original byte envelope and untouched source slices remain byte-identical
  - only edited semantic blocks are reserialized
  - saved output is reparsed for expected semantic equivalence before atomic replacement
  - fingerprint checks, external-change detection, typed failures, and recovery records prevent false save success
- Design-token constraints:
  - implement the named RooB values as semantic SCSS/CSS custom properties
  - Accent is reserved for the active semantic block cue
  - semantic status tokens communicate actual status and do not become decorative accents
- Performance constraints:
  - typing, selection, dirty acknowledgement, palette opening, and search navigation are effectively instant
  - search discards stale work, preserves keyboard position, and returns natural-height results without layout churn
  - G001 records startup, open, edit, search, save, plugin, and memory measurements before later budgets are frozen
- Compatibility constraints:
  - macOS is the first full validation host
  - paths, hotkeys, dialogs, menus, filesystem semantics, and process behavior remain behind cross-platform adapters
  - no platform-specific assumption may leak into the editor or plugin contract
- G001 test and screenshot expectations:
  - use a real Electron app and a real fixture with Chinese prose, headings, emphasis, links, lists and tasks, quote or callout, code, table, math, image, and one opaque unsupported block
  - capture light and dark at about 1440 by 900 and 900 by 700
  - exercise focus, active block, dirty, saved, permission grant, permission denial, plugin load failure, service crash, save error, modal containment, zoom, and overflow
  - read the renderer console and structured logs
  - reject generic code-editor chrome, raw Markdown default, split preview, weak contrast, clipped overlays, oversized whitespace, card styling, or false success
- G003 owns external-change detection, conflict presentation, recovery snapshots, and crash-recovery behavior. These are not G001 checkpoint blockers.
- Deferred scope:
  - public marketplace and untrusted renderer plugins
  - cloud, collaboration, accounts, publishing, mobile, browser, and PWA surfaces
  - final Windows and Linux visual certification
  - Rust acceleration without a measured TypeScript or Node bottleneck
  - perfect in-place editing for every Markdown extension

## Open questions

- [ ] Validate the exact available-width threshold at which the workspace sidebar and optional detail surface collapse. Owner: G001 shell implementation. Impact: document measure and compact navigation.
- [ ] Validate selection and scroll restoration when moving between Milkdown and deliberate CodeMirror full-source mode. Owner: editor adapter. Impact: source-mode safety.
- [ ] Freeze capability grant persistence, revocation, and expired-path behavior after the successful grant and denial spike. Owner: plugin host. Impact: Plugin Center copy and recovery.
- [ ] Decide the first-release UI language policy for mixed Chinese and English workspaces. Owner: product. Impact: localization and overflow evidence.
- [ ] Record the G001 go or no-go decision after real app screenshots, save/reopen proof, plugin isolation, accessibility, console, and structured-log review. Owner: G001 verifier. Impact: whether later Ultragoal work may proceed.

## G004 daily-writing visual repair decision

- Date: 2026-08-29
- Primary user: a daily writer who needs to stay inside one uninterrupted rendered Markdown document.
- Outcome: writing, reading, and correcting prose happens in one continuous Milkdown canvas. Source is exposed only when exact source intent requires it.
- Chassis: keep the existing editorial daily-tool shell and behavior. This is a visual hierarchy repair, not a new application structure.
- Light tokens, unchanged: Paper `#FAF9F6`, Panel `#F3F1EC`, Raised `#F2F1EE`, Ink `#34312E`, Hairline `#DDD9D2`, Accent `#A85D3B`, Muted `#6F6B66`, Success `#496B52`, Warning `#8A642D`, Danger `#93443F`, Focus `#34312E`.
- Dark tokens, unchanged: Paper `#1F1E1C`, Panel `#181715`, Raised `#292826`, Ink `#D7D4CF`, Hairline `#3B3935`, Accent `#E0A07A`, Muted `#A9A59E`, Success `#8BB697`, Warning `#D0A45F`, Danger `#D88780`, Focus `#F1EEE8`.
- Typography: CJK-first serif prose (`Songti SC`, `Noto Serif CJK SC`, `Source Han Serif SC`, serif), quiet CJK-first sans UI (`PingFang SC`, `Noto Sans CJK SC`, `Source Han Sans SC`, sans-serif), and mono source (`Menlo`, `Monaco`, `SF Mono`, `Consolas`, monospace).
- Signature: the terracotta active semantic marker is the only signature element. Accent does not decorate buttons, cards, paths, or status chrome.
- Prohibited treatments: gradients, blur, glass, texture, shadow stacks, and new dependencies.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ quiet title / compact path                state · save · theme               │
├──────────────────────────────────────────────────────────────────────────────┤
│                 Undo  Redo  Source  Format ▾                                 │
│                 small contextual command cluster                            │
│                                                                              │
│                 continuous rendered Markdown                                │
│                 centered 760 to 860 px document                              │
│                 no enclosing sheet border                                   │
│                 local terracotta active marker only                         │
│                                                                              │
│                 exact source-only annotation                                │
│                 compact, source visible, no card filler                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ thin file truth / dirty or saved state / actionable exception status         │
└──────────────────────────────────────────────────────────────────────────────┘
```

Acceptance:

- The title row contains only quiet document identity, concise save or dirty truth, save, and theme controls. Full path and full state remain available through native titles and accessible names without being duplicated across the surface.
- Undo, Redo, Source, and every formatting command remain keyboard accessible in a small cluster placed in the document top margin. The cluster has no horizontal overflow at 1440, 900, or 375 CSS pixels.
- The rendered document is a centered continuous 760 to 860 px measure at available wide sizes. It has no whole-document paper-sheet border, focus frame, or shadow. Caret and focus remain visible, and the local active semantic marker causes no layout shift.
- Opaque source-only nodes are compact editorial annotations. They expose and preserve the exact source without a repeated kicker, explanation paragraph, enclosing card chrome, or decorative filler.
- Ordinary saved outcomes do not create a large alert. Failure, conflict, recovery, copy-saved, cleanup-failed, and local binary rejection remain visible and actionable. Saved and dirty truth remain in the title row or thin status.
- Long paths and implementation identifiers truncate visually without losing their full native title or accessible name.
- Light and dark packaged screenshots and runtime geometry are validated at 1440, 900, and 375 CSS pixels.
