import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);

async function loadLicenses(scope) {
  const { stdout } = await run("pnpm", ["licenses", "list", scope, "--json"], { cwd: root });
  const byLicense = JSON.parse(stdout);
  return Object.values(byLicense).flatMap((packages) => packages.flatMap((pkg) =>
    pkg.versions.map((version) => ({ license: pkg.license, name: pkg.name, scope, version })),
  ));
}

const inventory = new Map();
for (const entry of [...await loadLicenses("--prod"), ...await loadLicenses("--dev")]) {
  const key = `${entry.name}@${entry.version}`;
  const prior = inventory.get(key);
  if (prior === undefined) {
    inventory.set(key, entry);
  } else if (prior.scope !== entry.scope) {
    prior.scope = "Runtime + development";
  }
}

const entries = [...inventory.values()]
  .map((entry) => ({
    ...entry,
    scope: entry.scope === "--prod" ? "Runtime" : entry.scope === "--dev" ? "Development" : entry.scope,
  }))
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

const rows = entries.map(({ license, name, scope, version }) => `| ${name} | ${version} | ${license} | ${scope} |`);
const document = `# WebEditor dependency license inventory

Generated from the frozen \`pnpm-lock.yaml\` dependency graph by \`pnpm run licenses\`. The Noto project itself is private and unlicensed; this inventory records third-party package metadata and does not relicense Noto.

| Package | Version | License | Use |
| --- | --- | --- | --- |
${rows.join("\n")}
`;

await writeFile(join(root, "DEPENDENCY_LICENSES.md"), document);
console.log(`Recorded ${entries.length} dependency license entries`);
