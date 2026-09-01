import { describe, expect, it } from 'vitest';
import { isTrustedRendererSender } from '../../src/main/ipc/trusted-renderer';

describe('renderer sender predicate', () => {
  it('accepts only the live main frame at the exact custom origin', () => {
    const mainFrame = { url: 'noto://bundle/index.html' };
    const webContents = { mainFrame };
    const window = { webContents };
    expect(isTrustedRendererSender(window, { sender: webContents, senderFrame: mainFrame })).toBe(true);
    expect(isTrustedRendererSender(window, { sender: {}, senderFrame: mainFrame })).toBe(false);
    expect(isTrustedRendererSender(window, { sender: webContents, senderFrame: { url: 'noto://bundle/frame.html' } })).toBe(false);
    expect(isTrustedRendererSender(window, { sender: webContents, senderFrame: { url: 'https://example.invalid/' } })).toBe(false);
    expect(isTrustedRendererSender(null, { sender: webContents, senderFrame: mainFrame })).toBe(false);
  });
});

