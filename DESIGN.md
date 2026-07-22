# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-07-22
- Primary product surfaces: macOS desktop editor window, workspace sidebar, Markdown editor, outline, status bar, preferences, command palette, export flow, plugin and remote-control surfaces
- Evidence reviewed:
  - `/Users/cdcd/Documents/NutStore/Nut/RooB/B000_Practical_Projects/B300_Almost_crack/B3006_typora/research`
  - `/Users/cdcd/roobli/lr00rl/Typora_Claude-Like_Theme`
  - `/Users/cdcd/roobli/lr00rl/typora-plugin-lite`
  - `/Users/cdcd/roobli/lr00rl/typora-plugin-remote-skill`
  - Typora for macOS behavior as a functional reference, not as a source of code or proprietary assets
- Assumptions:
  - Noto is initially a personal, non-commercial learning and research project.
  - Version 1 is macOS-first and desktop-only.
  - The application and editor source are fully editable; Apple platform frameworks remain external system dependencies.
  - Interaction should feel as close to Typora as practical while implementation, branding, icons, copy, and assets remain independent.

## Brand

- Personality: quiet, precise, local-first, technically trustworthy, focused on uninterrupted writing
- Trust signals: files remain ordinary Markdown, no silent normalization, explicit save/recovery state, predictable keyboard behavior, inspectable source, reversible commands
- Avoid:
  - copying Typora trademarks, logos, icons, bundled themes, strings, translations, proprietary resources, or internal code
  - generic Electron-dashboard aesthetics
  - decorative UI that competes with writing
  - hidden transformations that rewrite Markdown without an explicit command

## Product goals

- Goals:
  - deliver a Typora-like seamless WYSIWYM Markdown editing experience
  - keep UTF-8 Markdown text as the persistent source of truth
  - support Chinese/English technical writing, code, tables, images, math, outlines, and large local workspaces
  - provide native macOS file, menu, shortcut, window, print, PDF, dark-mode, and recovery behavior
  - evolve the user's Claude-like theme, typora-plugin-lite capabilities, and remote skill into first-party Noto systems
  - expose a stable, capability-scoped plugin API instead of relying on private host globals
- Non-goals for the first vertical slice:
  - Windows or Linux distribution
  - cloud sync, accounts, collaboration, comments, or publishing services
  - pixel-copying Typora proprietary assets or reproducing its activation/update protocols
  - full Markdown dialect coverage
  - DOCX/EPUB/LaTeX export
  - arbitrary plugin shell access by default
- Success signals:
  - fixture Markdown survives repeated edit/save cycles byte-for-byte except for explicit user edits
  - Chinese IME, selection, undo/redo, paste, drag/drop, and cursor transitions remain stable
  - a real folder can be opened, browsed, edited, atomically saved, externally changed, and recovered
  - the initial Claude-like visual system renders consistently in light and dark mode
  - existing pure plugin algorithms can run through a Noto-owned editor API

## Personas and jobs

- Primary personas:
  - the owner/developer using Noto as a daily technical Markdown workspace
  - future contributors learning desktop editor and plugin architecture
- User jobs:
  - open a Markdown file or folder and begin writing immediately
  - switch between rendered editing and explicit source inspection without losing text
  - navigate large note trees and outlines quickly
  - paste or drag images, edit code blocks and tables, render math, and export reliable PDF
  - automate the editor through commands and an authenticated local control API
- Key contexts of use:
  - long Chinese/English technical notes
  - code-heavy project documentation
  - local knowledge bases with many Markdown files
  - offline and privacy-sensitive work

## Information architecture

- Primary navigation:
  - native application menu and command palette
  - optional left workspace sidebar
  - central document editor
  - optional right outline/inspector
  - compact bottom status area
- Core routes/screens:
  - editor workspace
  - welcome/open-recent surface
  - preferences
  - theme and plugin management
  - export sheet
  - recovery/conflict sheet
- Content hierarchy:
  - workspace → folders/files → open documents → current document structure → block/inline content

## Design principles

- Markdown is the truth: rendering is a projection and must never silently become the canonical document.
- Source appears at the point of intent: syntax markers reveal around the active selection and recede elsewhere.
- Native outside, focused inside: macOS owns windows, menus, files, printing, and permissions; the web editor owns document interaction.
- Lossless before clever: unknown or malformed syntax is preserved and shown as source instead of being normalized or dropped.
- Capabilities over ambient authority: plugins receive explicit editor/file/command capabilities and no default arbitrary shell access.
- Tradeoffs:
  - first-party macOS fidelity is preferred over immediate cross-platform reach
  - source preservation is preferred over unrestricted rich-text transforms
  - deterministic behavior is preferred over maximum Markdown extension count

## Visual language

- Color:
  - begin from the user's Claude-like semantic tokens, not Typora bundled theme files
  - warm neutral document surfaces, restrained accent color, clear but quiet focus states
  - separate light and dark semantic tokens; do not generate dark mode by simple inversion
- Typography:
  - Chinese-first readable body stack
  - platform-native UI font
  - stable monospace stack for source and code
  - deliberate heading rhythm and line length suitable for long technical documents
- Spacing/layout rhythm:
  - calm document column with explicit default/wide/full modes
  - sidebars support dense navigation without reducing editor readability
  - no layout shift when syntax marks reveal around the cursor
- Shape/radius/elevation:
  - minimal radius and subtle separators
  - elevation only for transient popovers, palettes, and sheets
- Motion:
  - short, functional transitions for panels, palettes, and syntax reveal
  - no motion on ordinary cursor movement or typing
- Imagery/iconography:
  - SF Symbols where platform-appropriate
  - independent application icon and product mark
  - no copied Typora iconography

## Components

- Existing components to reuse:
  - Claude-like theme tokens, typography, table/code/sidenote visual rules after selector adaptation
  - typora-plugin-lite command registry, hotkey concepts, plugin lifecycle, settings concepts, and pure feature algorithms
  - typora-plugin-remote-skill JSON-RPC client and CLI contract where safe
- New/changed components:
  - Markdown text editor with syntax reveal and rendered decorations
  - native workspace/file coordinator
  - outline derived from the incremental syntax tree
  - atomic-save, external-change, conflict, and recovery services
  - first-party plugin capability bridge
  - theme token runtime independent of Typora DOM
  - command palette and Noto preferences
- Variants and states:
  - editor: default, source-focused, wide, full, read-only, conflict, recovery
  - sidebar: hidden, workspace, outline, search
  - blocks: inactive rendered projection, active source-revealed, invalid-source fallback
- Token/component ownership:
  - Noto owns semantic tokens and DOM contracts
  - plugins may consume documented tokens and extension points but may not target private structure

## Accessibility

- Target standard: WCAG 2.2 AA where applicable to the Web editor, plus native macOS accessibility semantics
- Keyboard/focus behavior:
  - complete menu and command access without a pointer
  - visible focus for palettes, popovers, settings, and sidebars
  - editor shortcuts do not trap Tab or override macOS conventions without an explicit setting
- Contrast/readability:
  - light/dark text and interactive states meet AA contrast targets
  - syntax dimming never makes editable source illegible
- Screen-reader semantics:
  - native controls expose labels and roles
  - rendered widgets retain accessible source descriptions
- Reduced motion and sensory considerations:
  - honor reduced-motion preference
  - do not rely on color alone for save, conflict, error, or selection state

## Responsive behavior

- Supported breakpoints/devices:
  - macOS desktop windows, initial minimum content width 720 px
  - optimized primary layouts at 900–1600 px
- Layout adaptations:
  - sidebars collapse before document measure becomes unreadable
  - sidenotes move inline below the desktop threshold
  - tables retain horizontal scrolling without displacing margin annotations
- Touch/hover differences:
  - pointer and keyboard are primary
  - hover affordances must have keyboard equivalents

## Interaction states

- Loading: show shell immediately, then restore workspace and document without blocking the menu system
- Empty: welcome surface with open file, open folder, recent workspaces, and new document
- Error: preserve source, state the failed operation, and provide retry/reveal-log actions
- Success: save state is quiet; explicit exports show a destination and completion result
- Disabled: explain the missing capability, unsupported syntax, or permission requirement
- Offline/slow network: core editing, themes, plugins, search, and export remain local and functional
- Conflict: never overwrite silently; show disk/current versions and preserve a recovery copy

## Content voice

- Tone: concise, factual, calm
- Terminology:
  - use “Markdown source”, “rendered editing”, “workspace”, “document”, “plugin”, and “command” consistently
  - reserve “source mode” for an explicit whole-document source presentation
- Microcopy rules:
  - state consequences before destructive actions
  - name the affected file and destination
  - distinguish unsupported, invalid, unavailable, and permission-denied states

## Implementation constraints

- Framework/styling system:
  - Swift 6 + AppKit for the initial macOS shell
  - an Xcode App project is the single source of truth for app build, signing, sandbox entitlements, bundled resources, and UI tests; reusable Swift logic may live in a local package, but there is no second executable entry point
  - WKWebView for the editor surface
  - TypeScript + CodeMirror 6 for the Markdown editor
  - CommonMark as the baseline with an explicit GFM compatibility matrix
  - HTML/CSS and WKWebView print/PDF for first-stage export
- Design-token constraints:
  - semantic CSS custom properties shared by editor and plugin surfaces
  - no direct dependency on Typora selectors or bundled resources
- Performance constraints:
  - typing and selection updates target one frame at 60 Hz for ordinary documents
  - scrolling remains interactive on the agreed large-document fixture
  - parsing and decoration updates are incremental and cancel stale work
  - startup restores the last workspace without scanning the full tree on the main thread
- Compatibility constraints:
  - initial target assumption: macOS 14+
  - the first slice supports documents up to 16 MiB and transfers large editor snapshots through an ordered, bounded, hashed chunk protocol
  - Chinese IME is a release gate
  - all persisted documents remain standard UTF-8 Markdown files
  - unknown Markdown syntax must round-trip unchanged
  - Web content loads only allowlisted bundled resources, has no arbitrary filesystem capability, and cannot navigate the editor view to external content
- Test/screenshot expectations:
  - golden source round-trip fixtures
  - editor-state unit tests
  - Swift bridge and file-coordination integration tests
  - end-to-end open/edit/save/reopen and external-change tests
  - manual Chinese IME matrix
  - light/dark visual regression for core blocks and window layouts

## Open questions

- [x] Use macOS 14+ as the first-slice deployment target; revisit only when compatibility work is scheduled / architecture plan
- [ ] Decide whether the first public repository license is MIT, Apache-2.0, GPL-compatible, or private-only / owner / dependency and contribution policy
- [x] Freeze the first-slice syntax matrix in `.omx/plans/prd-noto-first-vertical-slice.md`; GFM extensions are deferred / architecture plan
- [x] Treat only the measurable WYSIWYM, file-safety, and input behaviors in the PRD as requirements; all other Typora observations are historical reference / product plan
- [x] Treat math and diagram syntax as visible, byte-preserved source placeholders in the first slice / product plan
- [x] Defer remote control and method naming until the editor/file core is stable; do not expose a Typora-named public API in slice one / architecture plan
