import { it } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { splitBlocks } from '../../src/shared/markdown/v3/blocks';
import { docFromSpans } from '../../src/shared/markdown/v3/pm/from-mdast';
import { parseDocument } from '../../src/shared/markdown/v3/document';

/**
 * Splits the open path into its phases, on demand.
 *
 * Noto loses to Typora at half a megabyte, and "the double parse" was the
 * suspected cause, but that phrase covers three different jobs: scanning text
 * into block spans, producing mdast, and building ProseMirror nodes. Optimising
 * the wrong one is the usual way this goes wrong, so this measures them apart.
 *
 * Skipped by default because it is a measurement, not an assertion, and it
 * needs the generated corpus. Run it with:
 *
 *     PROFILE_OPEN=1 pnpm vitest run tests/unit/open-profile.test.ts
 */
const corpus = path.resolve(__dirname, '../../out/bench/corpus');
const enabled = process.env.PROFILE_OPEN === '1';

it.skipIf(!enabled)('profiles the phases of opening a document', { timeout: 300_000 }, async () => {
  const lines: string[] = [];
  const time = <T>(label: string, run: () => T): T => {
    const began = performance.now();
    const value = run();
    lines.push(`  ${label.padEnd(28)} ${(performance.now() - began).toFixed(0).padStart(6)} ms`);
    return value;
  };

  for (const name of ['small', 'medium', 'large']) {
    const file = path.join(corpus, `${name}.md`);
    const bytes = await readFile(file);
    lines.push(`\n${name} (${bytes.length.toLocaleString()} bytes)`);

    // What the main process does, which is already finished by the time the
    // renderer starts its own copy of the same work.
    time('main: parseDocument', () => parseDocument(bytes));

    const spans = time('renderer: splitBlocks', () => splitBlocks(bytes.toString('utf8')).spans);
    time('renderer: docFromSpans', () => docFromSpans(spans));
  }

  const out = path.resolve(__dirname, '../../out/bench/open-profile.txt');
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${lines.join('\n')}\n`, 'utf8');
  console.log(lines.join('\n'));
});
