/**
 * Run Noto from source, with the Vite dev servers and hot reload.
 *
 * A script rather than an inline environment assignment in package.json,
 * for the same reason as `make-installers.mjs`: `VAR=value command` is not
 * valid in Windows cmd, and a contributor on Windows has to be able to run
 * `pnpm start`.
 *
 * The variant is `release`, because a development run should exercise the
 * shipping surface. The `e2e` variant exists only to open the fuses Playwright
 * needs to attach, and nothing about running the app locally needs those.
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

process.env.NTO_PACKAGE_VARIANT = 'release';

const { api } = require('@electron-forge/core');
await api.start({ dir: root, interactive: false, ...(process.argv.includes('--inspect') ? { inspect: true } : {}) });
