# Third-party notices

Noto is currently a private, unlicensed research project. This file records
third-party software used by the G001 development build; it does not relicense
Noto or grant distribution rights for Noto itself.

## Apple platform frameworks

The native application links AppKit and WebKit from the installed Apple SDK.
Those system frameworks are not copied into this repository and remain subject
to Apple's platform terms.

## WebEditor runtime packages

The bundled editor uses CodeMirror 6 and its transitive runtime packages. The
frozen dependency graph records these runtime packages as MIT-licensed:

- `codemirror` and `@codemirror/*`
- `@lezer/*`
- `crelt`
- `style-mod`
- `w3c-keyname`
- `@marijn/find-cluster-break`

The authoritative package names, versions, declared licenses, and runtime or
development classification are generated from `WebEditor/pnpm-lock.yaml` into
`WebEditor/DEPENDENCY_LICENSES.md` by `pnpm --dir WebEditor run licenses`.

Before any public binary distribution, collect and review the exact upstream
license texts and copyright notices from the frozen packages. G001 establishes
the dependency inventory but does not authorize or publish a distributable app.
