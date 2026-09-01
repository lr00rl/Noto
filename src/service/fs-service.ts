import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  SERVICE_PROTOCOL_VERSION,
  isServiceInitializeMessage,
  isServiceReadMessage,
  type ServiceReplyMessage,
} from '../shared/plugins/protocol';

let received = 0;

function structuredLog(event: string, details: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    process: 'filesystem-service',
    event,
    ...details,
  })}\n`);
}

const serviceParentPort = process.parentPort;
if (!serviceParentPort) throw new Error('SERVICE_FAILED: Electron utility parent port is unavailable');

serviceParentPort.on('message', async (event) => {
  const port = event.ports[0];
  if (!port || !isServiceInitializeMessage(event.data)) {
    structuredLog('service_initialize_rejected');
    return;
  }
  const generation = event.data.generation;
  let permissionOutsideDenied = false;
  try {
    await readFile('/etc/hosts');
  } catch (error) {
    permissionOutsideDenied = error instanceof Error
      && ('code' in error ? String(error.code) === 'ERR_ACCESS_DENIED' : error.message.includes('permission'));
  }
  structuredLog('service_ready', { generation, permissionOutsideDenied });
  const ready: ServiceReplyMessage = {
    version: SERVICE_PROTOCOL_VERSION,
    type: 'ready',
    generation,
    pid: process.pid,
    permissionOutsideDenied,
  };
  port.postMessage(ready);
  port.on('message', async (messageEvent) => {
    const message = messageEvent.data;
    if (!isServiceReadMessage(message) || message.generation !== generation) {
      structuredLog('service_request_rejected', { generation });
      return;
    }
    received += 1;
    structuredLog('service_request_received', { generation, operation: 'read', received });
    try {
      const bytes = await readFile(message.absolutePath);
      const reply: ServiceReplyMessage = {
        version: SERVICE_PROTOCOL_VERSION,
        type: 'read-result',
        generation,
        correlationId: message.correlationId,
        ok: true,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.length,
        received,
      };
      port.postMessage(reply);
    } catch {
      const reply: ServiceReplyMessage = {
        version: SERVICE_PROTOCOL_VERSION,
        type: 'read-result',
        generation,
        correlationId: message.correlationId,
        ok: false,
        code: 'SERVICE_FAILED',
        message: 'Read failed',
        received,
      };
      port.postMessage(reply);
    }
  });
  port.start();
});

