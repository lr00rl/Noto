import { version } from 'electron/package.json';

const compilerProbe = {
  runtime: process.version,
  electron: version,
} satisfies Readonly<{ runtime: string; electron: string }>;

void compilerProbe;
