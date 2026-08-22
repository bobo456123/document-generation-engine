import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { projectConfigSchema } from '@bizdoc/config';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('bizdoc init', () => {
  it('creates a valid project without overwriting it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-init-'));
    roots.push(root);
    await execFileAsync('pnpm', ['exec', 'tsx', 'apps/cli/src/main.ts', 'init', root], { cwd: process.cwd() });
    const configFile = path.join(root, '.bizdoc', 'project.yaml');
    const initial = await readFile(configFile, 'utf8');
    expect(projectConfigSchema.parse(YAML.parse(initial)).project.name).toBe(path.basename(root));
    await expect(execFileAsync('pnpm', ['exec', 'tsx', 'apps/cli/src/main.ts', 'init', root], { cwd: process.cwd() })).rejects.toMatchObject({ code: 1 });
    expect(await readFile(configFile, 'utf8')).toBe(initial);
  });
});
