import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultProjectConfig } from '@bizdoc/config';
import { ProjectScanner } from '@bizdoc/project-scanner';
import { FrontendAnalyzer } from './index.js';

describe('FrontendAnalyzer', () => {
  it('extracts route, action, required field and request evidence from a Vue SFC fixture', async () => {
    const root = path.resolve('examples/crm-vue');
    const config = defaultProjectConfig('vue-fixture');
    config.sources.backend.path = '../crm-demo/backend';
    const inventory = await new ProjectScanner().scan(root, config);
    const source = inventory.sources.find((item) => item.name === 'frontend');
    if (!source) throw new Error('Vue fixture inventory incomplete');

    expect(source.framework).toBe('vue');
    const facts = await new FrontendAnalyzer().analyze(source);
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ROUTE', path: '/opportunities/create' }),
      expect.objectContaining({ kind: 'PAGE', name: 'CreateOpportunity' }),
      expect.objectContaining({ kind: 'ACTION', name: '创建商机' }),
      expect.objectContaining({ kind: 'FORM_FIELD', name: 'name', value: 'required' }),
      expect.objectContaining({ kind: 'API_CALL', method: 'POST', path: '/api/opportunities' }),
      expect.objectContaining({ kind: 'NAVIGATION', path: '/opportunities' }),
      expect.objectContaining({ kind: 'MESSAGE', value: '创建成功' }),
      expect.objectContaining({ kind: 'PERMISSION', value: 'opportunity:create' })
    ]));
    expect(facts.some((fact) => fact.kind === 'CONDITION')).toBe(true);
    expect(facts.some((fact) => fact.kind === 'API_CALL' && fact.path === '/opportunities')).toBe(false);
    for (const fact of facts) {
      expect(fact.evidence.file).toBeTruthy();
      expect(fact.evidence.startLine).toBeGreaterThan(0);
    }
  });

  it('redacts sensitive constants from facts and evidence excerpts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-frontend-secret-'));
    try {
      const file = path.join(root, 'Config.ts'); const secret = 'fixture-frontend-secret-123456';
      await writeFile(file, `export const APP_SECRET = '${secret}';\nfetch('/api/config');\n`);
      const facts = await new FrontendAnalyzer().analyze({ name: 'frontend', root, framework: 'react', files: [file], commit: null });
      expect(JSON.stringify(facts)).not.toContain(secret);
      expect(JSON.stringify(facts)).toContain('[REDACTED]');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
