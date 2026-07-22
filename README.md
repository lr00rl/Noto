# Noto

Noto is an independent, local-first macOS Markdown editor research project.
The first vertical slice uses a native AppKit shell and a bundled CodeMirror
editor while keeping ordinary UTF-8 Markdown as the durable source of truth.

## Requirements

- macOS 14 or newer
- Xcode with the macOS SDK
- The WebEditor toolchain documented in `WebEditor/`

## Native development build

```sh
xcodebuild \
  -project Noto.xcodeproj \
  -scheme Noto \
  -configuration Debug \
  -destination 'platform=macOS' \
  build
```

The Xcode project is the only application build, signing, sandbox, resource,
and native-test source of truth. WebEditor output is consumed from
`WebEditor/dist` and copied into the application bundle as `Editor/`.

## Project status and provenance

This repository is private and unlicensed until the owner selects a publication
posture. Typora is a behavior reference only. Noto does not copy Typora code,
DOM, assets, strings, themes, or private protocols.

See `DESIGN.md` and the approved documents under `.omx/plans/` for the binding
product and architecture contracts.
