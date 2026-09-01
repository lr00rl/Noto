# Noto product direction

Date: 2026-08-31

This document supersedes the sequencing in `docs/handoff/G005_PLUGIN_PLATFORM_HANDOFF.md`.
That handoff remains accurate as a description of what was built and how to verify it.
What changed is the priority order, following a direct instruction from the project owner.

## The three requirements

1. Genuinely cross platform. macOS, Windows and Linux are all first class, with signed
   installers and a CI matrix that proves each one.
2. As close to Typora's editing experience as we can get, without copying Typora's
   private implementation.
3. A plugin platform that hosts the owner's own plugins, with TypeScript throughout.

## Why the plan changed

The goal ledger reports G001 through G004 complete and treats the remaining work as
plugin platform hardening. That is true of the subsystems it names. It is not true of
the product. Measured against the three requirements above, the current build is an
architecture spike:

- It cannot open a file. `src/main/main.ts` derives the document path only from
  `--g001-file=` or `--g003-file=` arguments plus `NTO_G001_MODE` / `NTO_G003_MODE`
  environment variables. Line 85 removes the application menu on every platform. There
  is no open dialog, no recent files, no workspace, no file tree and no tabs.
- WYSIWYG editing reaches six block kinds. `src/shared/markdown/v2/core.ts` restricts
  `editableKinds` to heading, paragraph, bullet list, ordered list, quote and fenced
  code. Tables, task lists, math, callouts, frontmatter and raw HTML are rendered as
  read only source islands. Tables and math are the features Typora is known for, so
  this is close to inverted from the target.
- No GFM syntax is loaded at all, code fences have no highlighting, and pasting or
  dropping an image is rejected rather than handled.
- macOS is not merely the first platform, it is structural.
  `scripts/package-variant.mjs` throws on any non darwin host, `forge.config.ts` sets
  `makers: []` so no installer is produced for any platform including macOS, the
  repository contains no CI configuration, and the literal
  `macos-posix-file-object-v1` is embedded in the file truth wire contract at
  `src/shared/file-truth/v1/contracts.ts` and in two validators.
- Proof scaffolding runs inside the shipping binary. `runExperimentalRuntimeSmoke` is
  invoked from `main.ts`, and the renderer carries `testControl('fail-next-save')`,
  editor mount and unmount buttons, and two parallel application shells selected at
  runtime by a bootstrap flag.

Meanwhile G005 Slice 2A is building infrastructure for installing untrusted third party
packages: a digest addressed immutable store, probation runtimes, receipt CAS, journals
and race detecting copies. The owner's stated need is to run plugins he wrote himself.
That is a different trust model, and the untrusted case was being solved first.

## What is kept

The spike produced real assets and none of them are discarded.

The byte exact markdown projection with per slice preservation is the right idea and
generalises well. The atomic save, fingerprint and journal recovery discipline in
`src/main/file-truth/` is careful work that most editors get wrong. The capability
broker, the lease based ownership of renderer resources, and the per plugin process
isolation are all worth keeping. The sandboxed runtime host built for Slice 2A is
parked, not deleted, and becomes the second plugin trust tier later.

## Decisions

**Electron stays.** This is requirement driven rather than inertia. Tauri would use the
host's system webview, which on Linux means WebKitGTK. An editor whose value rests on
contenteditable, IME composition and ProseMirror behaving identically on every platform
cannot accept a webview that varies by operating system and distribution. The owner's
own `typora-plugin-lite` carries a `platform/` abstraction that exists precisely because
macOS Typora runs in WKWebView and blocks `file://` ESM. A bundled Chromium is the
feature here.

**Milkdown is removed, ProseMirror stays.** Milkdown contributed a CommonMark schema, a
remark serializer and a context container. Its serializer cannot preserve exact bytes,
which is why the opaque block system exists at all: blocks that must survive untouched
are deliberately kept out of Milkdown so its serializer never sees them. That is routing
around a dependency rather than using one. Everything difficult is already hand written
in `src/renderer/editor/milkdown/`. Making tables, math and diagrams into real editable
node views would mean fighting Milkdown's plugin model for no return.

This costs nothing in supply chain terms. The complete ProseMirror suite, including
`prosemirror-tables`, and the entire micromark and mdast stack were already installed as
Milkdown's transitive dependencies. Depending on them directly removes the six
`@milkdown/*` packages and lets us pin what we actually use. The dependency change that
introduced this direction was a net removal of 42 packages.

**All three platforms are first class.** File identity has to stop being a macOS POSIX
concept in the wire contract and become a platform neutral abstraction with per platform
adapters.

**Trusted plugins first.** The plugin API is designed against the eleven plugins that
actually ship in `typora-plugin-lite`, not invented in advance. Untrusted third party
package installation returns after the product exists.

## Order of work

The editor core comes first because it determines the plugin editing ABI, and because
building a product shell over an editor that cannot edit a table would mean building it
twice.

1. Own the markdown pipeline. A parser and a slice preserving serializer covering GFM,
   math, frontmatter and HTML, as pure logic with no Electron or DOM dependency.
2. Own the ProseMirror schema and node views, replacing Milkdown. Tables, task lists,
   math and highlighted code become real editable nodes.
3. Typora style live preview: syntax markers that appear only on the active node, input
   rules, and a per block source toggle.
4. Remove proof scaffolding from production and collapse the two application shells
   into one.
5. Product shell: platform aware menus, open, save and recents, workspace tree, tabs,
   outline, find and replace.
6. Platform neutral file identity with win32 and linux adapters.
7. Forge makers for all three platforms, signing configuration, CI matrix, and e2e
   specs that resolve the executable per platform.
8. Trusted plugin tier, with `title-shift` and `md-padding` ported as the first proof.

## Status of G005 Slice 2A

Parked, not abandoned, and not claimed as complete.

The runtime spike code in `src/main/plugins/experimental-*`,
`src/main/protocol/register-experimental-plugin-protocol.ts`,
`src/preload/plugin-preload.ts` and `src/renderer/plugin-runtime/` remains in the tree
and its unit tests keep running. The evidence directories under
`ElectronApp/test-results/g005-runtime-spike/` are retained.

What was true when it was parked stays true, and nobody should upgrade these claims:

- The post fix independent code review was never performed.
- The post fix independent verification was never performed.
- No final Slice 2A quality gate JSON exists.
- Local third party package import, immutable storage, receipts and journals were never
  implemented.
- The runtime spike was only ever proven on macOS.

When the sandboxed tier is revived, the acceptance criteria in sections 15, 16 and 20 of
the G005 handoff still apply and must be run fresh rather than inherited.
