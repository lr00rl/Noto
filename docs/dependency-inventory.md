# Dependency and provenance inventory

## Runtime dependencies

| Dependency | Source | Purpose | License/provenance |
| --- | --- | --- | --- |
| AppKit | macOS system framework | Application, window, menus | Apple platform SDK |
| WebKit | macOS system framework | Sandboxed editor surface | Apple platform SDK |
| WebEditor dependencies | `WebEditor/package.json` | Editor implementation and bundling | Owned and audited by the WebEditor lane |

## Repository policy

- The native application adds no third-party runtime package.
- The Xcode project is the sole executable build source of truth.
- WebEditor generated output is bundled from `WebEditor/dist`; the native build
  does not fetch dependencies or access the network.
- `/Applications/Typora.app` and any provided archive are behavior references
  only. Their code, DOM, assets, strings, themes, and private protocols are not
  repository inputs.
- Repository source is private and unlicensed until an explicit license is
  selected.

See [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) for the G001
runtime notice and `WebEditor/DEPENDENCY_LICENSES.md` for the generated frozen
package inventory.
