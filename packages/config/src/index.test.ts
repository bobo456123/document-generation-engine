import { describe, expect, it } from 'vitest';
import { defaultProjectConfig, projectConfigSchema } from './index.js';

describe('project config', () => {
  it('validates the default config', () => {
    expect(projectConfigSchema.parse(defaultProjectConfig('crm')).project.name).toBe('crm');
  });

  it('rejects embedded secrets', () => {
    const value = defaultProjectConfig('crm') as unknown as Record<string, unknown>;
    value.appSecret = 'not-allowed';
    expect(projectConfigSchema.safeParse(value).success).toBe(true);
    expect(projectConfigSchema.keyof().options).not.toContain('appSecret');
  });

  it('accepts an Anthropic Messages compatible provider without an embedded key', () => {
    const config = { ...defaultProjectConfig('crm'), ai: { provider: 'anthropic', model: 'glm-5.3', base_url: 'https://ai.example.test/v1' } };
    expect(projectConfigSchema.parse(config).ai).toEqual({ provider: 'anthropic', model: 'glm-5.3', base_url: 'https://ai.example.test/v1' });
  });
});
