import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { CredentialStore, MacOsKeychainCredentialBackend, defaultProjectConfig, findWorkspaceRoot, projectConfigSchema, requiredAiCredentialNames, resolveWorkspaceRoot, type CredentialBackend, type CredentialName, type KeychainCommand } from './index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('project config', () => {
  it('validates the default config', () => {
    expect(projectConfigSchema.parse(defaultProjectConfig('crm')).project.name).toBe('crm');
  });

  it('rejects embedded secrets', () => {
    const secret = 'fixture-secret-must-not-appear';
    const topLevel = { ...defaultProjectConfig('crm'), appSecret: secret };
    const ai = { ...defaultProjectConfig('crm'), ai: { provider: 'anthropic', model: 'test', api_key: secret } };
    const feishu = { ...defaultProjectConfig('crm'), publishing: { feishu: { space_id: 'test', app_secret: secret } } };
    for (const value of [topLevel, ai, feishu]) {
      const result = projectConfigSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) expect(JSON.stringify(result.error.issues)).not.toContain(secret);
    }
  });

  it('accepts an Anthropic Messages compatible provider without an embedded key', () => {
    const config = { ...defaultProjectConfig('crm'), ai: { provider: 'anthropic', model: 'glm-5.3', base_url: 'https://ai.example.test/v1' } };
    expect(projectConfigSchema.parse(config).ai).toEqual({ provider: 'anthropic', model: 'glm-5.3', base_url: 'https://ai.example.test/v1' });
  });

  it('requires a separate compatible base URL only when it is not configured in the project', () => {
    expect(requiredAiCredentialNames({ provider: 'openai-compatible' })).toEqual(['AI_API_KEY', 'AI_BASE_URL']);
    expect(requiredAiCredentialNames({ provider: 'openai-compatible', base_url: 'https://ai.example.test/v1' })).toEqual(['AI_API_KEY']);
    expect(requiredAiCredentialNames({ provider: 'anthropic' })).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('discovers a workspace from a nested current directory', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(tmpdir(), 'bizdoc-workspace-')));
    roots.push(root);
    await mkdir(path.join(root, '.bizdoc'), { recursive: true });
    await mkdir(path.join(root, 'nested', 'directory'), { recursive: true });
    await writeFile(path.join(root, '.bizdoc', 'project.yaml'), 'version: 1\n');
    await expect(findWorkspaceRoot(path.join(root, 'nested', 'directory'))).resolves.toBe(root);
    await expect(resolveWorkspaceRoot(path.join(root, 'nested'))).rejects.toThrow('Not a bizdoc workspace');
  });

  it('prefers environment credentials and never exposes their values through status', () => {
    class MemoryBackend implements CredentialBackend {
      readonly values = new Map<CredentialName, string>();
      get(name: CredentialName): string | undefined { return this.values.get(name); }
      set(name: CredentialName, value: string): void { this.values.set(name, value); }
      remove(name: CredentialName): boolean { return this.values.delete(name); }
    }
    const backend = new MemoryBackend();
    backend.set('ANTHROPIC_API_KEY', 'keychain-secret');
    const store = new CredentialStore(backend, { ANTHROPIC_API_KEY: 'environment-secret' });
    expect(store.get('ANTHROPIC_API_KEY')).toBe('environment-secret');
    expect(store.source('ANTHROPIC_API_KEY')).toBe('environment');
    expect(store.source('FEISHU_APP_SECRET')).toBe('missing');
  });

  it('passes Keychain secrets through stdin and redacts command failures', () => {
    const secret = 'fixture "keychain" secret';
    const execute: KeychainCommand = (args, options) => {
      expect(args).not.toContain(secret);
      expect(args).toEqual(['-i']);
      expect(options.input).toBe(`add-generic-password -U -s "test-service" -a "ANTHROPIC_API_KEY" -w ${JSON.stringify(secret)}\n`);
      throw new Error(`command failed with ${secret}`);
    };
    const backend = new MacOsKeychainCredentialBackend('test-service', execute);
    expect(() => backend.set('ANTHROPIC_API_KEY', secret)).toThrow('Failed to store ANTHROPIC_API_KEY in macOS Keychain');
    try { backend.set('ANTHROPIC_API_KEY', secret); } catch (error) { expect(String(error)).not.toContain(secret); }
  });

  it('restores previous persistent credentials when a multi-value update fails', () => {
    class FailingBackend implements CredentialBackend {
      readonly values = new Map<CredentialName, string>([['FEISHU_APP_ID', 'old-id'], ['FEISHU_APP_SECRET', 'old-secret']]);
      get(name: CredentialName): string | undefined { return this.values.get(name); }
      set(name: CredentialName, value: string): void { if (name === 'FEISHU_APP_SECRET' && value === 'new-secret') throw new Error(`unsafe ${value}`); this.values.set(name, value); }
      remove(name: CredentialName): boolean { return this.values.delete(name); }
    }
    const backend = new FailingBackend(); const store = new CredentialStore(backend, {});
    expect(() => store.setMany([['FEISHU_APP_ID', 'new-id'], ['FEISHU_APP_SECRET', 'new-secret']])).toThrow('previous values were restored');
    expect(backend.values).toEqual(new Map([['FEISHU_APP_ID', 'old-id'], ['FEISHU_APP_SECRET', 'old-secret']]));
  });

  it('reports an incomplete rollback when a newly stored credential cannot be removed', () => {
    class BrokenRollbackBackend implements CredentialBackend {
      readonly values = new Map<CredentialName, string>();
      get(name: CredentialName): string | undefined { return this.values.get(name); }
      set(name: CredentialName, value: string): void { if (name === 'FEISHU_APP_SECRET') throw new Error('write failed'); this.values.set(name, value); }
      remove(): boolean { return false; }
    }
    const store = new CredentialStore(new BrokenRollbackBackend(), {});
    expect(() => store.setMany([['FEISHU_APP_ID', 'new-id'], ['FEISHU_APP_SECRET', 'new-secret']])).toThrow('rollback was incomplete');
  });
});
