import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const virtualStore = path.join(root, 'node_modules', '.pnpm');
const outputRoot = path.join(root, 'resources', 'provenance');
const licenseNames = /^(licen[cs]e|copying|notice)(\..*)?$/i;

async function packageDirectories(nodeModulesDirectory) {
  const directories = [];
  for (const entry of await readdir(nodeModulesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const candidate = path.join(nodeModulesDirectory, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(candidate, { withFileTypes: true })) {
        if (scoped.isDirectory()) directories.push(path.join(candidate, scoped.name));
      }
    } else {
      directories.push(candidate);
    }
  }
  return directories;
}

const packages = new Map();
for (const storeEntry of await readdir(virtualStore, { withFileTypes: true })) {
  if (!storeEntry.isDirectory() || storeEntry.name === 'node_modules') continue;
  const nodeModulesDirectory = path.join(virtualStore, storeEntry.name, 'node_modules');
  let directories;
  try {
    directories = await packageDirectories(nodeModulesDirectory);
  } catch {
    continue;
  }

  for (const directory of directories) {
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
}

const inventory = [...packages.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
);
const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'));
const lockfileSha256 = createHash('sha256').update(lockfile).digest('hex');

const summary = [
  '# Resolved third-party package inventory',
  '',
  'Generated from the frozen pnpm virtual store. Do not edit by hand.',
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

