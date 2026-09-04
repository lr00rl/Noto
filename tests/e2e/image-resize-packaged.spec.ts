import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import { packagedExecutable } from './packaged-app';

/** A flat grey PNG of the given size, built by hand so no fixture file is needed. */
function pngOf(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(typed));
    return Buffer.concat([length, typed, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x99)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function invokeMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
      for (const item of items) {
        if (item.id === wanted) return item;
        const nested = item.submenu ? find(item.submenu.items) : null;
        if (nested) return nested;
      }
      return null;
    };
    const target = find(Menu.getApplicationMenu()!.items);
    if (!target) throw new Error(`no menu item ${wanted}`);
    target.click();
  }, id);
}

test("dragging a picture's corner writes Typora's zoom into the note", async () => {
  const workspace = path.join(process.cwd(), 'test-results', 'image-resize');
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, 'user-data'), { recursive: true });
  const vault = path.join(workspace, 'vault');
  await mkdir(vault, { recursive: true });
  const file = path.join(vault, 'note.md');
  await writeFile(path.join(vault, 'pic.png'), pngOf(400, 100));
  await writeFile(file, '# Pictures\n\n![pic](pic.png)\n\nAfter.\n', 'utf8');
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${path.join(workspace, 'user-data')}`, vault],
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('[data-testid="file-tree"]', { state: 'visible', timeout: 30_000 });
    await page.getByTestId('tree-file').first().click();
    const editor = page.locator('.canvas-slot:not([hidden]) .ProseMirror');
    await editor.waitFor({ state: 'visible' });
    const img = editor.locator('img.noto-image');
    await expect.poll(() => img.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(400);

    // Drag the corner a hundred pixels to the left: the picture follows and
    // the note holds the tag with the zoom Typora would write.
    const drag = async (dx: number) => {
      await editor.locator('.noto-image-frame').hover();
      const handle = editor.locator('.noto-image-handle');
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y, { steps: 4 });
      await page.mouse.move(x + dx, y, { steps: 4 });
      await page.mouse.up();
    };
    await drag(-100);
    await expect.poll(() => img.evaluate((node) => (node as HTMLElement).style.zoom)).toMatch(/^0\.7/);
    await expect(editor.locator('.noto-inline-html[data-preview="image"]')).toHaveCount(1);
    await invokeMenu(app, 'save');
    await expect.poll(() => readFile(file, 'utf8')).toMatch(/<img src="pic\.png" alt="pic" style="zoom:7\d%;" \/>/);
    // The rest of the note is as it was.
    expect(await readFile(file, 'utf8')).toContain('# Pictures\n\n<img');
    expect(await readFile(file, 'utf8')).toContain('/>\n\nAfter.\n');

    // Dragging the tag's picture rewrites only its zoom.
    await drag(-100);
    await invokeMenu(app, 'save');
    await expect.poll(() => readFile(file, 'utf8')).toMatch(/style="zoom:[45]\d%;"/);
    expect(await readFile(file, 'utf8')).not.toContain('![pic]');
  } finally {
    await app.close();
  }
});
