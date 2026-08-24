import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import { z } from 'zod';

export const credentialNames = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'AI_API_KEY', 'AI_BASE_URL', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET'] as const;
export type CredentialName = typeof credentialNames[number];
export type CredentialTarget = 'anthropic' | 'openai' | 'deepseek' | 'qwen' | 'openai-compatible' | 'feishu';

export const credentialNamesByTarget: Record<CredentialTarget, CredentialName[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  qwen: ['DASHSCOPE_API_KEY'],
  'openai-compatible': ['AI_API_KEY', 'AI_BASE_URL'],
  feishu: ['FEISHU_APP_ID', 'FEISHU_APP_SECRET']
};

export function requiredAiCredentialNames(ai: { provider: Exclude<CredentialTarget, 'feishu'>; base_url?: string | undefined }): CredentialName[] {
  return credentialNamesByTarget[ai.provider].filter((name) => name !== 'AI_BASE_URL' || !ai.base_url);
}

export const projectConfigSchema = z.object({
  version: z.literal(1),
  project: z.object({ name: z.string().min(1), display_name: z.string().min(1).optional() }).strict(),
  sources: z.object({
    frontend: z.object({ path: z.string().min(1), framework: z.enum(['auto', 'react', 'vue', 'umi']).default('auto') }).strict(),
    backend: z.object({ path: z.string().min(1), framework: z.literal('spring-boot') }).strict()
  }).strict(),
  analysis: z.object({
    include: z.array(z.string()).default(['src/**']), exclude: z.array(z.string()).default([]),
    mappings: z.array(z.object({
      frontend: z.object({ method: z.string(), path: z.string() }).strict(),
      backend: z.object({ method: z.string(), path: z.string() }).strict(),
      label: z.string().optional()
    }).strict()).default([])
  }).strict().default({ include: ['src/**'], exclude: [], mappings: [] }),
  ai: z.object({ provider: z.enum(['openai', 'deepseek', 'qwen', 'anthropic', 'openai-compatible']), model: z.string().min(1), base_url: z.string().url().optional() }).strict().optional(),
  publishing: z.object({
    feishu: z.object({ space_id: z.string().min(1), parent_node_token: z.string().optional(), default_module: z.string().min(1).optional() }).strict().optional()
  }).strict().optional()
}).strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const file = path.join(root, '.bizdoc', 'project.yaml');
  const parsed: unknown = YAML.parse(await readFile(file, 'utf8'));
  return projectConfigSchema.parse(parsed);
}

export const defaultProjectConfig = (name: string, displayName?: string): ProjectConfig => ({
  version: 1,
  project: { name, ...(displayName ? { display_name: displayName } : {}) },
  sources: {
    frontend: { path: './frontend', framework: 'auto' },
    backend: { path: './backend', framework: 'spring-boot' }
  },
  analysis: { include: ['src/**'], exclude: ['**/generated/**'], mappings: [] }
});

export async function findWorkspaceRoot(start = process.cwd()): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    try {
      await access(path.join(current, '.bizdoc', 'project.yaml'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new Error(`No bizdoc workspace found from ${path.resolve(start)}. Run 'bizdoc init' in a business documentation directory first.`);
      current = parent;
    }
  }
}

export async function resolveWorkspaceRoot(explicit?: string): Promise<string> {
  if (explicit !== undefined) {
    const root = path.resolve(explicit);
    try {
      await access(path.join(root, '.bizdoc', 'project.yaml'));
      return root;
    } catch {
      throw new Error(`Not a bizdoc workspace: ${root}. Expected .bizdoc/project.yaml in that directory.`);
    }
  }
  return findWorkspaceRoot();
}

export interface CredentialBackend {
  get(name: CredentialName): string | undefined;
  set(name: CredentialName, value: string): void;
  remove(name: CredentialName): boolean;
}

export type KeychainCommand = (args: string[], options: { input?: string; captureOutput: boolean }) => string;

const runKeychainCommand: KeychainCommand = (args, options) => execFileSync('/usr/bin/security', args, {
  encoding: 'utf8',
  ...(options.input === undefined ? {} : { input: options.input }),
  stdio: ['pipe', options.captureOutput ? 'pipe' : 'ignore', 'ignore']
});

export class MacOsKeychainCredentialBackend implements CredentialBackend {
  constructor(private readonly service = 'tech.bizdoc.cli', private readonly execute: KeychainCommand = runKeychainCommand) {}

  get(name: CredentialName): string | undefined {
    try {
      return this.execute(['find-generic-password', '-s', this.service, '-a', name, '-w'], { captureOutput: true }).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  set(name: CredentialName, value: string): void {
    try {
      const command = ['add-generic-password', '-U', '-s', JSON.stringify(this.service), '-a', JSON.stringify(name), '-w', JSON.stringify(value)].join(' ');
      this.execute(['-i'], { input: `${command}\n`, captureOutput: false });
    } catch {
      throw new Error(`Failed to store ${name} in macOS Keychain`);
    }
  }

  remove(name: CredentialName): boolean {
    try {
      this.execute(['delete-generic-password', '-s', this.service, '-a', name], { captureOutput: false });
      return true;
    } catch {
      return false;
    }
  }
}

class UnsupportedCredentialBackend implements CredentialBackend {
  get(): undefined { return undefined; }
  set(): void { throw new Error('Persistent credential storage currently requires macOS Keychain. Use environment variables on this platform.'); }
  remove(): boolean { return false; }
}

export class CredentialStore {
  private readonly backend: CredentialBackend;

  constructor(backend?: CredentialBackend, private readonly environment: NodeJS.ProcessEnv = process.env) {
    this.backend = backend ?? (os.platform() === 'darwin' ? new MacOsKeychainCredentialBackend() : new UnsupportedCredentialBackend());
  }

  get(name: CredentialName): string | undefined {
    return this.environment[name] || this.backend.get(name);
  }

  require(name: CredentialName): string {
    const value = this.get(name);
    if (!value) throw new Error(`${name} is not configured. Run the matching 'bizdoc auth set' command or provide the environment variable.`);
    return value;
  }

  source(name: CredentialName): 'environment' | 'keychain' | 'missing' {
    if (this.environment[name]) return 'environment';
    return this.backend.get(name) ? 'keychain' : 'missing';
  }

  set(name: CredentialName, value: string): void {
    if (!value.trim()) throw new Error(`${name} cannot be empty`);
    this.backend.set(name, value);
  }

  setMany(entries: Array<readonly [CredentialName, string]>): void {
    for (const [name, value] of entries) if (!value.trim()) throw new Error(`${name} cannot be empty`);
    const previous = new Map(entries.map(([name]) => [name, this.backend.get(name)]));
    const changed: CredentialName[] = [];
    try {
      for (const [name, value] of entries) { this.backend.set(name, value); changed.push(name); }
    } catch {
      let rollbackFailed = false;
      for (const name of changed.reverse()) {
        try {
          const value = previous.get(name);
          if (value === undefined) { if (!this.backend.remove(name)) rollbackFailed = true; } else this.backend.set(name, value);
        } catch { rollbackFailed = true; }
      }
      throw new Error(rollbackFailed ? 'Credential update failed and rollback was incomplete; run auth status and configure the target again' : 'Credential update failed; previous values were restored');
    }
  }

  remove(name: CredentialName): boolean {
    return this.backend.remove(name);
  }
}
