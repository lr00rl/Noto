import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface StructuredLogger {
  filePath: string;
  log(event: string, details?: Record<string, unknown>): void;
}

export function summarizeUntrustedText(value: unknown): { bytes: number; sha256: string } {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function createLogger(directory: string): StructuredLogger {
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, 'main.ndjson');
  return {
    filePath,
    log(event, details = {}) {
      appendFileSync(filePath, `${JSON.stringify({
        timestamp: new Date().toISOString(),
        process: 'main',
        event,
        ...details,
      })}\n`, { encoding: 'utf8', mode: 0o600 });
    },
  };
}
