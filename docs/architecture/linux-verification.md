# Linux verification

The cross-platform requirement asks for a CI matrix that builds and tests
macOS, Windows and Linux. The workflow describes all three, but a workflow that
has never run is a description rather than evidence. This records what has
actually been executed on Linux, and what has not.

## What was run

A `node:22` container, arm64, with the source copied in and no `node_modules`
carried over, so the install was genuinely clean:

```
docker run --rm -v "$PWD/ElectronApp/out/linux-ci:/work" -w /work node:22
```

Results:

| step                        | result                        |
| --------------------------- | ----------------------------- |
| `pnpm compat:node22`         | passed                        |
| `pnpm typecheck`             | clean                         |
| `pnpm test`                  | 608 passed, 43 files          |
| `pnpm package:e2e`           | produced `Noto-linux-arm64`   |
| `pnpm exec playwright test`  | 45 passed under `xvfb-run`    |

The 45 is the full suite minus the three release-surface tests, which skip
themselves when the release variant has not been built. The container built the
e2e variant only.

This means the platform-neutral file identity, the Linux file-truth adapter, the
workspace, tabs, find and replace, the file tree, settings, math rendering and
the plugin tier all work on Linux, not merely compile for it.

## A problem this found

`pnpm install --frozen-lockfile` does not produce `node_modules/electron/dist`
on a clean checkout, even though `allowBuilds` in `pnpm-workspace.yaml` permits
electron's build script and that is the correct key for pnpm 11.
`pnpm rebuild electron` does not produce it either. Running the script directly
does:

```
node node_modules/electron/install.js
```

Without the binary, packaging fails on `electron/dist/LICENSE` and every
packaged test fails to launch. The CI workflow now runs that script explicitly
in both jobs that package the app.

The reason is now established, and it is not that pnpm refuses to run the
script. There is no script left to run. Reading the installed manifest inside
the container:

```
node -e 'console.log(JSON.stringify(require("/work/node_modules/electron/package.json").scripts))'
undefined
```

electron's published package declares `postinstall: node install.js`, but the
copy pnpm 11 installs has no `scripts` field at all. That is why
`pnpm ignored-builds` reports "None" and why `pnpm rebuild electron` does
nothing: from pnpm's point of view the package has no build to run, so
`allowBuilds` never comes into it. Running `install.js` directly is therefore
the correct remedy rather than a hack.

## Two cross-platform bugs this found

Both would have failed the matrix on its first run.

Six e2e specs hard coded `Noto-darwin-arm64/Noto.app/Contents/MacOS/Noto`, so
the Windows and Linux legs would have looked for a macOS bundle that the run had
not produced. Path resolution now lives in `tests/e2e/packaged-app.ts`, and the
Linux run above resolving `/work/out/e2e/Noto-linux-arm64/noto` is the proof it
works.

`scripts/package-variant.mjs` looked for an executable named `Noto` on Linux,
while the Forge config sets `executableName` to `noto` there. The package
verification guard would have rejected a correctly built Linux package.

## Installers

`pnpm make:release` has now been run and produced real artifacts on two
platforms.

| platform | artifact                        | size   |
| -------- | ------------------------------- | ------ |
| macOS    | `Noto-darwin-arm64-0.1.0.zip`   | 131 MB |
| Linux    | `noto_0.1.0_arm64.deb`          | 89 MB  |
| Linux    | `noto-0.1.0-1.arm64.rpm`        | 98 MB  |

The macOS zip contains a complete `Noto.app` with its executable, a 9.7 MB
`app.asar` and the Electron frameworks. The release build's fuses are hardened:
`RunAsNode` disabled, `EnableNodeOptionsEnvironmentVariable` disabled,
`EnableNodeCliInspectArguments` disabled, `OnlyLoadAppFromAsar` enabled and
`EnableEmbeddedAsarIntegrityValidation` enabled. The Debian package declares its
runtime dependencies and installs the binary, the asar and a `.desktop` entry;
`rpm -qip` reads the RPM cleanly.

Getting there required fixing three things that had never been exercised because
the makers had never been run.

**The package was still named after retired scaffolding.** `package.json` had
`"name": "noto-electron-g001"`, so `electron-installer-common` looked for a
binary called `noto-electron-g001` and failed. Renamed to `noto`, which is what
the Forge config already sets `executableName` to on Linux.

**RPM refuses to build without a License field**, and the project declared none.
Set to `UNLICENSED`, npm's convention for no rights granted. This is a
placeholder: choosing a licence is the owner's decision, and if Noto is ever
distributed it needs a real one.

**The description called the product a Milkdown spike.** Installed Debian and
RPM packages carried "Executable Electron and Milkdown architecture spike for
Noto" in their metadata, describing a dependency that was removed entirely and a
status the project left long ago.

## An unexplained reversion

While rebuilding the macOS artifact, the three `package.json` fixes above were
found reverted to their original values, after having demonstrably been in place
when the Linux packages were built from them. They were reapplied.

The obvious suspect was the packaging pipeline rewriting the manifest, which
some Electron tooling does. It does not: `package:release` and `make:release`
were both run against a saved copy and left the file byte identical. The one
run that behaved differently was a `make:release` that exited 1 and left a
truncated 379 KB temporary file in `out/make`, so a failed make is the remaining
suspect, but this has not been reproduced.

Worth knowing about, because the failure mode is silent: a build that quietly
uses an older manifest than the one on disk would ship the wrong metadata
without anything reporting an error. The packaged manifest is now verified by
reading it back out of the asar rather than by trusting the source file.

## What is still unproven

Windows. Nothing in this project has been built or run on Windows, and no
Windows machine or container was available. The `win32` file-truth adapter, the
Squirrel installer and the Windows e2e run are all unverified, and the Squirrel
maker is the one path where the package rename above has not been checked.

Both Linux artifacts are arm64, because the container is. The x64 build is
unexercised, though nothing in the failures above was architecture specific.

The macOS zip has not been unpacked and run from a fresh location, and the RPM
has not been installed.

The Debian package has been installed and started, but not driven. `dpkg -i`
unpacks and configures it cleanly and creates `/usr/bin/noto` as a symlink to
`/usr/lib/noto/noto`. Launching that binary under `xvfb-run` runs for as long as
it is given, emitting only D-Bus warnings that come from the container having no
system bus.

Attaching Playwright to the installed binary, however, times out waiting for the
first window, from both the symlink and the real path.
`scripts/bench/verify-installed.mjs` does this and currently fails in the
container. The same Playwright version drives the *built* binary in the same
container without trouble, which is how the 45 packaged tests run, so this looks
like something about launching from an installed location rather than a fault in
the application. It is unexplained, and until it is, "the installed application
works" is supported only by the process staying up, not by anything it did.
