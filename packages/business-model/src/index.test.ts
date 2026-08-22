import { describe, expect, it } from 'vitest';
import { businessSnapshotSchema } from './index.js';

describe('BusinessModelSnapshot evidence integrity', () => {
  it('rejects feature evidence IDs that do not exist in snapshot facts', () => {
    const result = businessSnapshotSchema.safeParse({
      id: 'snapshot:1', runId: 'run:1', createdAt: new Date(0).toISOString(), commits: {}, facts: [],
      features: [{ id: 'feature:1', name: 'test', module: 'test', roles: [], frontendRefs: [], backendRefs: [], apiRefs: [], entities: [], fields: [], rules: [], outcomes: [], confidence: 'inferred', evidenceIds: ['evidence:missing'] }],
      unlinkedFrontendFactIds: [], unlinkedBackendFactIds: [], conflicts: []
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain('Dangling evidence ID');
  });
});
