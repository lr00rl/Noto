import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });

await build({
  absWorkingDir: root,
  bundle: true,
  entryNames: "editor",
  entryPoints: ["src/editor.ts"],
  format: "esm",
  legalComments: "none",
  minify: true,
  outdir: "dist",
  platform: "browser",
  sourcemap: false,
  target: ["safari17"],
});

await cp(join(root, "src", "index.html"), join(dist, "index.html"));

const outputs = (await readdir(dist)).sort();
const expected = ["editor.css", "editor.js", "index.html"];
if (outputs.join("\n") !== expected.join("\n")) {
  throw new Error(`Unexpected bundle outputs: ${outputs.join(", ")}`);
}

console.log(`Built ${outputs.join(", ")}`);
