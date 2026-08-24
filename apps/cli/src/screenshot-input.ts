import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
type ExecuteFile = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export async function chooseScreenshotFile(platform = os.platform(), execute: ExecuteFile = execFileAsync): Promise<string> {
  if (platform !== 'darwin') throw new Error('The native screenshot file picker currently requires macOS. Pass the image path explicitly on this platform.');
  try {
    const result = await execute('/usr/bin/osascript', ['-e', 'POSIX path of (choose file with prompt "选择已脱敏的页面截图")']);
    const selected = result.stdout.trim();
    if (!selected) throw new Error('Screenshot selection was cancelled');
    return selected;
  } catch (error) {
    if (error instanceof Error && error.message === 'Screenshot selection was cancelled') throw error;
    throw new Error('Screenshot selection was cancelled or unavailable');
  }
}

export async function captureScreenshot(platform = os.platform(), execute: ExecuteFile = execFileAsync): Promise<{ file: string; cleanup: () => Promise<void> }> {
  if (platform !== 'darwin') throw new Error("Interactive capture currently requires macOS. Use 'bizdoc screenshot add <file>' on this platform.");
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bizdoc-capture-'));
  const file = path.join(directory, 'capture.png');
  try {
    await execute('/usr/sbin/screencapture', ['-i', '-o', '-x', file]);
    await access(file);
    return { file, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error('Screenshot capture was cancelled or failed');
  }
}
