import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectScanner } from '@bizdoc/project-scanner';
import { FrontendAnalyzer } from '@bizdoc/analyzer-frontend';
import { SpringAnalyzer } from '@bizdoc/analyzer-spring';
import { FeatureLinker } from './index.js';

describe('analysis contract', () => {
  it('links a UI request to its Spring endpoint with evidence', async () => {
    const root = path.resolve('examples/crm-demo');
    const inventory = await new ProjectScanner().scan(root, {
      version: 1, project: { name: 'demo' }, sources: {
        frontend: { path: './frontend', framework: 'react' }, backend: { path: './backend', framework: 'spring-boot' }
      }, analysis: { include: ['src/**'], exclude: [], mappings: [] }
    });
    const frontend = inventory.sources.find((source) => source.name === 'frontend');
    const backend = inventory.sources.find((source) => source.name === 'backend');
    if (!frontend || !backend) throw new Error('fixture inventory incomplete');
    const facts = [...await new FrontendAnalyzer().analyze(frontend), ...await new SpringAnalyzer().analyze(backend)];
    const snapshot = new FeatureLinker().link({ runId: 'run:test', facts, commits: { frontend: null, backend: null } });
    expect(snapshot.features).toHaveLength(1);
    expect(snapshot.features[0]?.apiRefs[0]).toMatchObject({ method: 'POST', path: '/api/opportunities' });
    expect(snapshot.features[0]?.evidenceIds.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.features[0]?.entry?.action).toBe('创建商机');
    expect(snapshot.features[0]?.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'name', required: true })]));
    expect(snapshot.facts.some((fact) => fact.kind === 'ACTION' && fact.name === '创建商机')).toBe(true);
    expect(snapshot.facts.some((fact) => fact.kind === 'VALIDATION' && fact.name === 'name')).toBe(true);
  });

  it('does not match the same path with a different method', () => {
    const ev = { id: 'e', source: 'SOURCE_CODE' as const, file: 'x', startLine: 1 };
    const snapshot = new FeatureLinker().link({ runId: 'run:test', commits: {}, facts: [
      { id: 'front', kind: 'API_CALL', name: 'request', method: 'GET', path: '/x', confidence: 'verified', evidence: ev },
      { id: 'back', kind: 'HTTP_ENDPOINT', name: 'create', method: 'POST', path: '/x', confidence: 'verified', evidence: ev }
    ] });
    expect(snapshot.features).toHaveLength(0);
    expect(snapshot.unlinkedFrontendFactIds).toEqual(['front']);
    expect(snapshot.unlinkedBackendFactIds).toEqual(['back']);
  });

  it('reports ambiguous backend matches as a conflict', () => {
    const ev = { id: 'e', source: 'SOURCE_CODE' as const, file: 'x', startLine: 1 };
    const snapshot = new FeatureLinker().link({ runId: 'run:test', commits: {}, facts: [
      { id: 'front', kind: 'API_CALL', name: 'request', method: 'POST', path: '/x', confidence: 'verified', evidence: ev },
      { id: 'back-1', kind: 'HTTP_ENDPOINT', name: 'one', method: 'POST', path: '/x', confidence: 'verified', evidence: ev },
      { id: 'back-2', kind: 'HTTP_ENDPOINT', name: 'two', method: 'POST', path: '/x', confidence: 'verified', evidence: ev }
    ] });
    expect(snapshot.features).toHaveLength(0);
    expect(snapshot.conflicts[0]?.factIds).toEqual(['front', 'back-1', 'back-2']);
  });

  it('uses an explicit mapping and records MANUAL_INPUT evidence', () => {
    const ev = { id: 'e', source: 'SOURCE_CODE' as const, file: 'x', startLine: 1 };
    const snapshot = new FeatureLinker().link({ runId: 'run:test', commits: {}, mappings: [{ frontend: { method: 'POST', path: '/frontend/save' }, backend: { method: 'PUT', path: '/backend/save' }, label: '保存映射' }], facts: [
      { id: 'front', kind: 'API_CALL', name: 'request', method: 'POST', path: '/frontend/save', confidence: 'verified', evidence: ev },
      { id: 'back', kind: 'HTTP_ENDPOINT', name: 'save', method: 'PUT', path: '/backend/save', confidence: 'verified', evidence: ev }
    ] });
    expect(snapshot.features[0]?.confidence).toBe('inferred');
    expect(snapshot.facts.find((fact) => fact.kind === 'MAPPING')?.evidence.source).toBe('MANUAL_INPUT');
  });

  it('merges multiple APIs used by the same page context', () => {
    const ev = (id: string, file: string) => ({ id, source: 'SOURCE_CODE' as const, file, startLine: 1, repository: 'frontend' });
    const facts = [
      { id: 'api-1', kind: 'API_CALL' as const, name: 'saveLead', owner: 'saveLead', method: 'POST', path: '/lead/save', confidence: 'verified' as const, evidence: ev('e1', 'services/lead.ts') },
      { id: 'api-2', kind: 'API_CALL' as const, name: 'saveRecord', owner: 'saveRecord', method: 'POST', path: '/record/save', confidence: 'verified' as const, evidence: ev('e2', 'services/record.ts') },
      { id: 'call-1', kind: 'SERVICE_CALL' as const, name: 'saveLead', target: 'saveLead', confidence: 'verified' as const, evidence: ev('e3', 'pages/Convert.tsx') },
      { id: 'call-2', kind: 'SERVICE_CALL' as const, name: 'saveRecord', target: 'saveRecord', confidence: 'verified' as const, evidence: ev('e4', 'pages/Convert.tsx') },
      { id: 'back-1', kind: 'HTTP_ENDPOINT' as const, name: 'LeadController.save', method: 'POST', path: '/lead/save', confidence: 'verified' as const, evidence: { ...ev('e5', 'LeadController.java'), repository: 'backend' } },
      { id: 'back-2', kind: 'HTTP_ENDPOINT' as const, name: 'RecordController.save', method: 'POST', path: '/record/save', confidence: 'verified' as const, evidence: { ...ev('e6', 'RecordController.java'), repository: 'backend' } }
    ];
    const snapshot = new FeatureLinker().link({ runId: 'run:test', commits: {}, facts });
    expect(snapshot.features).toHaveLength(1);
    expect(snapshot.features[0]?.apiRefs).toHaveLength(2);
    expect(snapshot.features[0]?.entry?.page).toBe('pages/Convert.tsx');
  });
});
