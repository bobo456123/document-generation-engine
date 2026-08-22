import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenshotManager } from './index.js';
import { Persistence } from '@bizdoc/persistence';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

describe('ScreenshotManager', () => {
  it('validates and imports a PNG using content, not extension', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-shot-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const source = path.join(root, 'screen.bin'); await writeFile(source, png);
    const asset = await new ScreenshotManager().import(root, source);
    expect(asset).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
  });

  it('rejects invalid image content', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-shot-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const source = path.join(root, 'fake.png'); await writeFile(source, 'not an image');
    await expect(new ScreenshotManager().import(root, source)).rejects.toThrow();
  });

  it('rejects excessive dimensions and deduplicates repeated assets by content hash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-shot-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const oversized = Buffer.from(png); oversized.writeUInt32BE(20_000, 16);
    const oversizedFile = path.join(root, 'oversized.png'); await writeFile(oversizedFile, oversized);
    await expect(new ScreenshotManager().import(root, oversizedFile)).rejects.toThrow('dimensions exceed');

    const source = path.join(root, 'screen.png'); await writeFile(source, png);
    const manager = new ScreenshotManager(); const first = await manager.import(root, source); const second = await manager.import(root, source);
    const persistence = new Persistence(root); persistence.migrate();
    expect(persistence.saveAsset(first)).toBe(persistence.saveAsset(second));
    expect(persistence.db.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 1 });
    persistence.close();
  });
});
