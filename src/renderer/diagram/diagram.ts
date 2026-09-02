/**
 * The diagram frame.
 *
 * Mermaid draws a diagram by writing an SVG full of inline styles, which the
 * editor's content security policy refuses, and it does so from text the
 * reader wrote, which the editor does not run. So it runs here, in a frame
 * sandboxed to nothing: no origin, no bridge, no way to reach the page that
 * holds it. The page posts a source and a palette in; the frame posts a
 * height or an error out. Nothing else crosses.
 */

import mermaid from 'mermaid';
import type { DiagramReply, DiagramRequest } from './protocol';

const container = document.getElementById('diagram') as HTMLDivElement;

let latest = 0;

function reply(message: DiagramReply): void {
  window.parent.postMessage(message, '*');
}

function isRequest(data: unknown): data is DiagramRequest {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return record.type === 'noto-diagram-render'
    && typeof record.serial === 'number'
    && typeof record.source === 'string'
    && typeof record.font === 'string'
    && typeof record.dark === 'boolean'
    && typeof record.palette === 'object' && record.palette !== null;
}

function measure(): { width: number; height: number } {
  const svg = container.querySelector('svg');
  if (!svg) return { width: 0, height: 0 };
  const rect = svg.getBoundingClientRect();
  return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
}

async function draw(request: DiagramRequest): Promise<void> {
  const { serial, source, palette, dark, font } = request;
  latest = serial;
  mermaid.initialize({
    startOnLoad: false,
    // Strict: no click handlers, no scripts in labels, HTML in labels sanitised.
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    darkMode: dark,
    fontFamily: font,
    themeVariables: {
      darkMode: dark,
      background: palette.paper,
      fontFamily: font,
      fontSize: '14px',
      primaryColor: palette.raised,
      primaryTextColor: palette.ink,
      primaryBorderColor: palette.lineStrong,
      secondaryColor: palette.raised,
      secondaryTextColor: palette.ink,
      secondaryBorderColor: palette.hairline,
      tertiaryColor: palette.paper,
      tertiaryTextColor: palette.ink,
      tertiaryBorderColor: palette.hairline,
      lineColor: palette.muted,
      textColor: palette.ink,
      mainBkg: palette.raised,
      nodeBorder: palette.lineStrong,
      nodeTextColor: palette.ink,
      clusterBkg: palette.paper,
      clusterBorder: palette.hairline,
      titleColor: palette.inkStrong,
      edgeLabelBackground: palette.paper,
      actorBkg: palette.raised,
      actorBorder: palette.lineStrong,
      actorTextColor: palette.ink,
      actorLineColor: palette.hairline,
      signalColor: palette.ink,
      signalTextColor: palette.ink,
      labelBoxBkgColor: palette.raised,
      labelBoxBorderColor: palette.lineStrong,
      labelTextColor: palette.ink,
      loopTextColor: palette.ink,
      noteBkgColor: palette.raised,
      noteTextColor: palette.ink,
      noteBorderColor: palette.hairline,
      activationBkgColor: palette.raised,
      activationBorderColor: palette.lineStrong,
      sequenceNumberColor: palette.paper,
      pie1: palette.accent,
    },
  });
  try {
    const { svg } = await mermaid.render(`noto-diagram-${serial}`, source);
    if (serial !== latest) return;
    container.innerHTML = svg;
    reply({ type: 'noto-diagram-rendered', serial, ...measure() });
  } catch (error) {
    if (serial !== latest) return;
    container.replaceChildren();
    const text = error instanceof Error ? error.message : String(error);
    reply({ type: 'noto-diagram-failed', serial, message: text.split('\n', 1)[0].slice(0, 200) });
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (!isRequest(event.data)) return;
  void draw(event.data);
});

// A diagram may name a link, and mermaid draws it as a real anchor even at
// its strictest. The page holding this frame lets no pointer event reach it
// and the sandbox opens no window, but neither is this frame's to rely on:
// nothing here is ever followed.
document.addEventListener('click', (event) => event.preventDefault(), true);
document.addEventListener('auxclick', (event) => event.preventDefault(), true);

// The page that holds the frame sizes it by what is reported; when the frame
// is made narrower the drawing scales and its height changes with it.
new ResizeObserver(() => {
  if (!container.querySelector('svg')) return;
  reply({ type: 'noto-diagram-rendered', serial: latest, ...measure() });
}).observe(container);

reply({ type: 'noto-diagram-ready' });
