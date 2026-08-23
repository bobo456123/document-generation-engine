import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenshotManager } from './index.js';
import { Persistence } from '@bizdoc/persistence';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');

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

  it.each([
    ['JPEG', jpeg, 'image/jpeg'],
    ['WebP', webp, 'image/webp']
  ])('imports %s screenshots based on content', async (_label, content, mimeType) => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-shot-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const source = path.join(root, 'misleading.bin'); await writeFile(source, content);
    await expect(new ScreenshotManager().import(root, source)).resolves.toMatchObject({ mimeType, width: 1, height: 1 });
  });

  it('rejects files larger than 10 MB before image parsing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-shot-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const source = path.join(root, 'large.png'); await writeFile(source, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(new ScreenshotManager().import(root, source)).rejects.toThrow('exceeds 10 MB');
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
