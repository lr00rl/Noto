/**
 * What the host filesystem can actually promise.
 *
 * The save algorithm is identical everywhere: write a temp file, flush it,
 * apply metadata, verify the expected fingerprint, rename over the original,
 * make the directory entry durable, read back. Three of those steps mean
 * different things per platform, and pretending otherwise is how a save reports
 * success on Windows while having verified nothing.
 *
 * Each capability below is a fact about the OS, not a feature flag. Nothing
 * here is configurable at runtime.
 */

export type NotoPlatformId = 'darwin' | 'win32' | 'linux';

export interface PlatformCapabilities {
  readonly id: NotoPlatformId;

  /**
   * Whether POSIX permission bits round trip.
   *
   * Unix: yes, so Noto restores the original mode and verifies it, and a
   * mismatch fails the save rather than silently changing permissions.
   *
   * Windows: no. `chmod` there only toggles the read-only attribute, so
   * verifying an exact mode would fail every save. The mode is still recorded
   * so it survives a document opened on one platform and saved on another.
   */
  readonly preservesPosixMode: boolean;

  /**
   * Whether a directory handle can be opened and fsynced.
   *
   * Unix: yes, and Noto does it, because on Unix a rename is not durable until
   * the parent directory entry is flushed.
   *
   * Windows: no. Directories cannot be opened as files through Node, and
   * `MoveFileEx` with replace semantics is already atomic and journalled by
   * NTFS. Skipping the flush there is correct rather than a compromise, but it
   * does mean durability rests on the filesystem's own journal.
   */
  readonly canSyncDirectory: boolean;

  /**
   * Whether hard links are available for publishing a copy without overwriting
   * an existing destination. Windows supports them on NTFS but not on FAT or
   * exFAT volumes, and failures there are reported rather than guessed at.
   */
  readonly canHardLink: boolean;
}

const DARWIN: PlatformCapabilities = {
  id: 'darwin',
  preservesPosixMode: true,
  canSyncDirectory: true,
  canHardLink: true,
};

const LINUX: PlatformCapabilities = {
  id: 'linux',
  preservesPosixMode: true,
  canSyncDirectory: true,
  canHardLink: true,
};

const WIN32: PlatformCapabilities = {
  id: 'win32',
  preservesPosixMode: false,
  canSyncDirectory: false,
  canHardLink: true,
};

export function capabilitiesFor(platform: NodeJS.Platform): PlatformCapabilities {
  if (platform === 'darwin') return DARWIN;
  if (platform === 'win32') return WIN32;
  // Every other Node platform Electron ships on is Unix-like. Treating an
  // unknown one as Linux keeps the stronger guarantees; if the assumption is
  // wrong the mode verification fails loudly instead of quietly skipping.
  return LINUX;
}

export const currentCapabilities = (): PlatformCapabilities => capabilitiesFor(process.platform);
