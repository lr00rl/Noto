import { isAllowedRendererUrl } from '../protocol/register-app-protocol';

interface SenderFrameLike { url: string }
interface WebContentsLike { mainFrame: SenderFrameLike }
interface WindowLike { webContents: WebContentsLike }
interface InvokeEventLike { sender: unknown; senderFrame: SenderFrameLike | null }

export function isTrustedRendererSender(window: WindowLike | null, event: InvokeEventLike): boolean {
  return Boolean(window
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame
    && isAllowedRendererUrl(event.senderFrame.url));
}
