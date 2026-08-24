import { access } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { captureScreenshot, chooseScreenshotFile } from './screenshot-input.js';

describe('screenshot CLI input', () => {
  it('uses the macOS file picker without a shell', async () => {
    const execute = vi.fn(async () => ({ stdout: '/tmp/example.png\n', stderr: '' }));
    await expect(chooseScreenshotFile('darwin', execute)).resolves.toBe('/tmp/example.png');
    expect(execute).toHaveBeenCalledWith('/usr/bin/osascript', expect.any(Array));
  });

  it('captures to a temporary file and exposes cleanup', async () => {
    const execute = vi.fn(async (_command: string, args: string[]) => {
      await import('node:fs/promises').then(({ writeFile }) => writeFile(args.at(-1)!, 'fixture'));
      return { stdout: '', stderr: '' };
    });
    const captured = await captureScreenshot('darwin', execute);
    await expect(access(captured.file)).resolves.toBeUndefined();
    await captured.cleanup();
    await expect(access(captured.file)).rejects.toThrow();
  });

  it('treats a successful process without an image as a cancelled capture', async () => {
    await expect(captureScreenshot('darwin', vi.fn(async () => ({ stdout: '', stderr: '' })))).rejects.toThrow('cancelled or failed');
  });

  it('gives an actionable fallback on other platforms', async () => {
    await expect(captureScreenshot('linux')).rejects.toThrow('screenshot add');
  });
});
