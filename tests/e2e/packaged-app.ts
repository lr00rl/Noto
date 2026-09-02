/**
 * Where the packaged app is, on whichever platform the tests are running.
 *
 * Every spec used to spell out `Noto-darwin-arm64/Noto.app/Contents/MacOS/Noto`
 * itself. That works on one developer's machine and fails everywhere else, so
 * the Windows and Linux legs of the CI matrix could only ever have failed: they
 * would look for a macOS bundle that the run had not produced.
 *
 * Forge names the output directory after the platform and architecture it built
 * for, and puts the executable in a different place on each. Both facts live
 * here so a spec never has to know either.
 */

import path from 'node:path';
import type { Locator, Page } from '@playwright/test';

export type PackageVariant = 'e2e' | 'release';

/** The executable inside a package directory, which differs per platform. */
export function executableRelativePath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return path.join('Noto.app', 'Contents', 'MacOS', 'Noto');
  if (platform === 'win32') return 'Noto.exe';
  // Lower case on Linux, matching `executableName` in the Forge config.
  return 'noto';
}

/** The directory Forge writes a package to, for example `Noto-linux-x64`. */
export function packageDirectory(
  variant: PackageVariant = 'e2e',
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return path.join(process.cwd(), 'out', variant, `Noto-${platform}-${arch}`);
}

/** Full path to the packaged executable the tests should launch. */
export function packagedExecutable(
  variant: PackageVariant = 'e2e',
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return path.join(packageDirectory(variant, platform, arch), executableRelativePath(platform));
}

/** The asar the packaged app loads, used by the release surface checks. */
export function packagedAsar(
  variant: PackageVariant = 'e2e',
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const root = packageDirectory(variant, platform, arch);
  return platform === 'darwin'
    ? path.join(root, 'Noto.app', 'Contents', 'Resources', 'app.asar')
    : path.join(root, 'resources', 'app.asar');
}

/**
 * The modifier key for the platform.
 *
 * Command on macOS, Control elsewhere, which is the same distinction the
 * application menu makes with `CmdOrCtrl`.
 */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Moving the caret to the start of the line.
 *
 * macOS uses Command with an arrow where other platforms use Home, so a test
 * that types at a known position has to ask for the right one.
 */
export const LINE_START = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home';

/**
 * Click to place the caret, and wait until the editor knows where it is.
 *
 * A click lets the browser put the caret where it landed, and ProseMirror
 * learns of the new position from the `selectionchange` event, which the
 * browser delivers a moment later. A test can press a key inside that moment;
 * a person cannot. Keys pressed in it are handled against the selection the
 * editor still holds from before the click, at the top of the document, which
 * is where the intermittent failures of the constructs suite came from. So
 * the wait is for the event itself, with a short ceiling for the case where
 * the click lands where the caret already was and no event follows.
 */
export async function placeCaret(page: Page, target: Locator): Promise<void> {
  const settled = page.evaluate(() => new Promise<void>((resolve) => {
    document.addEventListener('selectionchange', () => resolve(), { once: true });
    setTimeout(resolve, 400);
  }));
  await target.click();
  await settled;
}
