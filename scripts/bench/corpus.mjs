/**
 * Generates the benchmark corpus.
 *
 * Documents are shaped like real notes rather than one repeated paragraph:
 * headings, prose, lists, tables, code fences and math in the proportions a
 * long technical document actually has. A corpus of nothing but paragraphs
 * would flatter any editor, because the expensive work (fence highlighting,
 * table layout, math) is exactly what it would omit.
 *
 * The generator is deterministic, so a run is comparable with the last one.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Deterministic pseudo-random source, so every run produces the same corpus. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const WORDS = ('the quick brown fox jumps over a lazy dog while parsing markdown into blocks and '
  + 'serializing them back to bytes without losing a single byte of the original file content')
  .split(' ');

function sentence(random, words) {
  const picked = [];
  for (let index = 0; index < words; index += 1) {
    picked.push(WORDS[Math.floor(random() * WORDS.length)]);
  }
  const text = picked.join(' ');
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

function paragraph(random) {
  const sentences = [];
  for (let index = 0; index < 3 + Math.floor(random() * 3); index += 1) {
    sentences.push(sentence(random, 8 + Math.floor(random() * 12)));
  }
  return sentences.join(' ');
}

function codeFence(random, index) {
  const lines = [`export function handler${index}(input: string): number {`];
  for (let line = 0; line < 4 + Math.floor(random() * 6); line += 1) {
    lines.push(`  const value${line} = input.length * ${Math.floor(random() * 100)};`);
  }
  lines.push('  return value0;', '}');
  return ['```ts', ...lines, '```'].join('\n');
}

function table(random) {
  const rows = ['| Name | Count | Notes |', '| --- | ---: | --- |'];
  for (let row = 0; row < 3 + Math.floor(random() * 4); row += 1) {
    rows.push(`| item ${row} | ${Math.floor(random() * 1000)} | ${sentence(random, 4)} |`);
  }
  return rows.join('\n');
}

/**
 * One section: a heading and a mix of blocks.
 *
 * Returns blocks rather than a string so the caller can count them, which is
 * what the per-block costs are measured against.
 */
function section(random, index) {
  const blocks = [`## Section ${index}`, paragraph(random)];
  const kind = index % 5;
  if (kind === 0) blocks.push(codeFence(random, index));
  if (kind === 1) blocks.push(table(random));
  if (kind === 2) {
    blocks.push(['- first item', '- second item', '  - nested item', '- [ ] a task', '- [x] a done task'].join('\n'));
  }
  if (kind === 3) blocks.push('$$\n\\sum_{i=0}^{n} x_i = \\frac{n(n+1)}{2}\n$$');
  if (kind === 4) blocks.push(`> ${sentence(random, 12)}`);
  blocks.push(paragraph(random));
  return blocks;
}

/** Build a document of at least the requested size, ending on a block boundary. */
export function buildDocument(targetBytes, seed = 7) {
  const random = seeded(seed);
  const blocks = ['# Benchmark document', paragraph(random)];
  let size = 0;
  let index = 0;
  while (size < targetBytes) {
    const next = section(random, index);
    blocks.push(...next);
    size += next.reduce((total, block) => total + block.length + 2, 0);
    index += 1;
  }
  return { markdown: `${blocks.join('\n\n')}\n`, blocks: blocks.length };
}

const SIZES = [
  ['small', 64 * 1024],
  ['medium', 512 * 1024],
  ['large', 2 * 1024 * 1024],
  ['huge', 8 * 1024 * 1024],
];

async function main() {
  const root = process.argv[2] ?? path.join(process.cwd(), 'out', 'bench', 'corpus');
  await mkdir(root, { recursive: true });
  const manifest = [];
  for (const [name, target] of SIZES) {
    const { markdown, blocks } = buildDocument(target);
    const file = path.join(root, `${name}.md`);
    await writeFile(file, markdown, 'utf8');
    manifest.push({ name, file, bytes: Buffer.byteLength(markdown), blocks });
    process.stdout.write(`${name}: ${(Buffer.byteLength(markdown) / 1024).toFixed(0)} KiB, ${blocks} blocks\n`);
  }
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
