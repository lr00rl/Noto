import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const virtualStore = path.join(root, 'node_modules', '.pnpm');
const outputRoot = path.join(root, 'resources', 'provenance');
const licenseNames = /^(licen[cs]e|copying|notice)(\..*)?$/i;

/**
 * Every installed package directory reachable from one `node_modules`.
 *
 * Recurses, because a package that needs a version different from the hoisted
 * one keeps its own copy nested underneath, and that copy is a dependency of
 * the shipped app exactly like the hoisted ones are.
 */
async function packageDirectories(nodeModulesDirectory) {
  const directories = [];
  let entries;
  try {
    entries = await readdir(nodeModulesDirectory, { withFileTypes: true });
  } catch {
    return directories;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const candidate = path.join(nodeModulesDirectory, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(candidate, { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue;
        const scopedPath = path.join(candidate, scoped.name);
        directories.push(scopedPath);
        directories.push(...await packageDirectories(path.join(scopedPath, 'node_modules')));
      }
    } else {
      directories.push(candidate);
      directories.push(...await packageDirectories(path.join(candidate, 'node_modules')));
    }
  }
  return directories;
}

/**
 * Where the installed packages are, which depends on the linker.
 *
 * pnpm's default puts a directory per resolved package under `.pnpm`. This
 * workspace sets `nodeLinker: hoisted`, which Forge needs to pack a flat tree,
 * and that layout leaves `.pnpm` holding nothing but a lock file. Reading only
 * the virtual store therefore produced an inventory of zero packages and an
 * empty notices file, which is a worse artifact than none at all.
 */
async function installedPackageDirectories() {
  const storeRoots = [];
  try {
    for (const entry of await readdir(virtualStore, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      storeRoots.push(path.join(virtualStore, entry.name, 'node_modules'));
    }
  } catch {
    // No virtual store at all, which is the hoisted case below.
  }
  if (storeRoots.length > 0) {
    const directories = [];
    for (const storeRoot of storeRoots) directories.push(...await packageDirectories(storeRoot));
    return directories;
  }
  return packageDirectories(path.join(root, 'node_modules'));
}

const packages = new Map();
for (const directory of await installedPackageDirectories()) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue;
  const key = `${manifest.name}@${manifest.version}`;
  if (packages.has(key)) continue;

  const files = await readdir(directory, { withFileTypes: true });
  const notices = [];
  for (const file of files) {
    if (!file.isFile() || !licenseNames.test(file.name)) continue;
    const content = await readFile(path.join(directory, file.name), 'utf8');
    notices.push({ name: file.name, content });
  }
  packages.set(key, {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license ?? manifest.licenses ?? 'UNDECLARED',
    repository: typeof manifest.repository === 'string'
      ? manifest.repository
      : manifest.repository?.url ?? null,
    notices,
  });
}

if (packages.size === 0) {
  throw new Error('No installed packages found. Run pnpm install before generating the inventory.');
}

const inventory = [...packages.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
);
const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'));
const lockfileSha256 = createHash('sha256').update(lockfile).digest('hex');

const summary = [
  '# Resolved third-party package inventory',
  '',
  'Generated from the installed dependency tree. Do not edit by hand.',
  '',
  `- Lockfile SHA-256: \`${lockfileSha256}\``,
  `- Unique resolved packages: ${inventory.length}`,
  `- Packages with copied license or notice text: ${inventory.filter((item) => item.notices.length > 0).length}`,
  `- Packages without a root license or notice file: ${inventory.filter((item) => item.notices.length === 0).length}`,
  '',
  '| Package | Declared license | License files | Repository |',
  '| --- | --- | --- | --- |',
  ...inventory.map((item) => {
    const license = typeof item.license === 'string' ? item.license : JSON.stringify(item.license);
    const files = item.notices.map((notice) => notice.name).join(', ') || 'none found';
    return `| \`${item.name}@${item.version}\` | ${license} | ${files} | ${item.repository ?? ''} |`;
  }),
  '',
  '## Copied license and notice texts',
  '',
];

for (const item of inventory) {
  if (item.notices.length === 0) continue;
  summary.push(`### ${item.name}@${item.version}`, '');
  for (const notice of item.notices) {
    summary.push(`#### ${notice.name}`, '', '```text', notice.content.trimEnd(), '```', '');
  }
}

/*
 * `--check` verifies rather than writes.
 *
 * It compares only the lockfile hash the committed inventory recorded, not the
 * inventory itself, because the resolved set legitimately differs per platform:
 * the optional watcher and esbuild binaries a macOS install pulls are not the
 * ones a Linux runner pulls, so a strict comparison would fail on every CI run
 * for a correct file. The hash catches the failure that actually matters,
 * which is dependencies changing without the notices being regenerated.
 */
if (process.argv.includes('--check')) {
  const committed = JSON.parse(
    await readFile(path.join(outputRoot, 'THIRD_PARTY_INVENTORY.json'), 'utf8'),
  );
  if (committed.lockfileSha256 !== lockfileSha256) {
    throw new Error(
      'The third-party inventory was generated from a different lockfile. '
      + 'Run pnpm license:inventory and commit the result.',
    );
  }
  if (!Array.isArray(committed.packages) || committed.packages.length === 0) {
    throw new Error('The committed third-party inventory is empty.');
  }
  console.log(JSON.stringify({ lockfileSha256, committedPackages: committed.packages.length }));
  process.exit(0);
}

await mkdir(outputRoot, { recursive: true });
await writeFile(
  path.join(outputRoot, 'THIRD_PARTY_INVENTORY.json'),
  `${JSON.stringify({ lockfileSha256, packages: inventory.map(({ notices, ...item }) => ({
    ...item,
    noticeFiles: notices.map((notice) => notice.name),
  })) }, null, 2)}\n`,
);
await writeFile(path.join(outputRoot, 'THIRD_PARTY_NOTICES.md'), `${summary.join('\n')}\n`);

console.log(JSON.stringify({
  lockfileSha256,
  uniquePackages: inventory.length,
  copiedNotices: inventory.reduce((count, item) => count + item.notices.length, 0),
}));

