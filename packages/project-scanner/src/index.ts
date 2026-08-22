import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import type { ProjectConfig } from '@bizdoc/config';

const execFileAsync = promisify(execFile);

export interface SourceInventory {
  name: 'frontend' | 'backend';
  root: string;
  framework: string;
  files: string[];
  commit: string | null;
}
export interface ProjectInventory { root: string; sources: SourceInventory[]; scannedAt: string }

async function gitCommit(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
    return stdout.trim();
  } catch { return null; }
}

async function detectedFrontendFramework(root: string, configured: string): Promise<string> {
  if (configured !== 'auto') return configured;
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    if (pkg.dependencies?.['@umijs/max']) return 'umi';
    if (pkg.dependencies?.vue) return 'vue';
    if (pkg.dependencies?.react) return 'react';
  } catch { /* reported through inventory when files are missing */ }
  return 'unknown';
}

export class ProjectScanner {
  async scan(root: string, config: ProjectConfig): Promise<ProjectInventory> {
    const frontendRoot = path.resolve(root, config.sources.frontend.path);
    const backendRoot = path.resolve(root, config.sources.backend.path);
    await Promise.all([access(frontendRoot), access(backendRoot)]);
    const commonIgnore = ['**/.git/**', '**/node_modules/**', '**/target/**', '**/dist/**', '**/build/**', '**/*.min.js', '**/generated/**', ...config.analysis.exclude];
    const configuredInclude = config.analysis.include.length ? config.analysis.include : ['**/*'];
    const include = [...new Set(configuredInclude.flatMap((pattern) => pattern.startsWith('**/') ? [pattern] : [pattern, `**/${pattern}`]))];
    const [frontendFiles, backendFiles, frontendCommit, backendCommit, frontendFramework] = await Promise.all([
      fg(include, { cwd: frontendRoot, absolute: true, ignore: commonIgnore, onlyFiles: true }).then((files) => files.filter((file) => /\.(?:ts|tsx|js|jsx|vue|json)$/.test(file))),
      fg(include, { cwd: backendRoot, absolute: true, ignore: commonIgnore, onlyFiles: true }).then((files) => files.filter((file) => /\.(?:java|yml|yaml|properties|xml)$/.test(file))),
      gitCommit(frontendRoot), gitCommit(backendRoot), detectedFrontendFramework(frontendRoot, config.sources.frontend.framework)
    ]);
    return {
      root,
      scannedAt: new Date().toISOString(),
      sources: [
        { name: 'frontend', root: frontendRoot, framework: frontendFramework, files: frontendFiles.sort(), commit: frontendCommit },
        { name: 'backend', root: backendRoot, framework: config.sources.backend.framework, files: backendFiles.sort(), commit: backendCommit }
      ]
    };
  }
}
