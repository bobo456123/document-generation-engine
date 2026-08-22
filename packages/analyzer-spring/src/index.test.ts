import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultProjectConfig } from '@bizdoc/config';
import { ProjectScanner } from '@bizdoc/project-scanner';
import { SpringAnalyzer } from './index.js';

describe('SpringAnalyzer', () => {
  it('extracts endpoint, service, DTO, validation, entity, permission, state change and data access facts', async () => {
    const root = path.resolve('examples/crm-demo');
    const inventory = await new ProjectScanner().scan(root, defaultProjectConfig('spring-fixture'));
    const source = inventory.sources.find((item) => item.name === 'backend');
    if (!source) throw new Error('Spring fixture inventory incomplete');

    const analyzer = new SpringAnalyzer();
    const facts = await analyzer.analyze(source);
    for (const expectedKind of ['HTTP_ENDPOINT', 'SERVICE_CALL', 'DTO', 'VALIDATION', 'ENTITY', 'PERMISSION', 'STATE_CHANGE', 'CONDITION', 'EXCEPTION', 'DATA_ACCESS'] as const) {
      expect(facts.some((fact) => fact.kind === expectedKind), `missing ${expectedKind}`).toBe(true);
    }
    expect(facts.find((fact) => fact.kind === 'STATE_CHANGE' && fact.value === 'PENDING')).toMatchObject({ name: 'status', value: 'PENDING' });
    expect(facts.find((fact) => fact.kind === 'HTTP_ENDPOINT')).toMatchObject({ target: 'Opportunity' });
    expect(facts.find((fact) => fact.kind === 'HTTP_ENDPOINT')?.value).toContain('OpportunityRequest');
    expect(analyzer.failures).toEqual([]);
  });
});
