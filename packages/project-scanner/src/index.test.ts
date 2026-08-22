import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectScanner } from './index.js';

describe('ProjectScanner', () => {
  it('discovers both fixture sources without executing them', async () => {
    const root = path.resolve('examples/crm-demo');
    const inventory = await new ProjectScanner().scan(root, {
      version: 1, project: { name: 'demo' }, sources: {
        frontend: { path: './frontend', framework: 'auto' }, backend: { path: './backend', framework: 'spring-boot' }
      }, analysis: { include: ['src/**'], exclude: [], mappings: [] }
    });
    expect(inventory.sources.find((source) => source.name === 'frontend')?.framework).toBe('react');
    expect(inventory.sources.flatMap((source) => source.files).some((file) => file.endsWith('OpportunityController.java'))).toBe(true);
    expect(inventory.sources.flatMap((source) => source.files).some((file) => file.endsWith('package.json'))).toBe(false);
    expect(inventory.sources.find((source) => source.name === 'backend')?.files.some((file) => file.includes('/src/main/'))).toBe(true);
  });
});
