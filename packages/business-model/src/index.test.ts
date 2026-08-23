import { describe, expect, it } from 'vitest';
import { businessSnapshotSchema, REDACTED_VALUE, redactSensitiveText, sanitizeCodeFact } from './index.js';

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

describe('sensitive code fact redaction', () => {
  it('redacts credential values while preserving traceability metadata', () => {
    const secret = 'fixture-secret-value-123456';
    const fact = sanitizeCodeFact({
      id: 'fact:secret', kind: 'STATE_CHANGE', name: 'APP_SECRET', value: secret, confidence: 'verified',
      evidence: { id: 'evidence:secret', source: 'SOURCE_CODE', file: 'Config.java', symbol: 'Config.appSecret', startLine: 12, excerpt: `setAppSecret("${secret}")` }
    });
    expect(fact.value).toBe(REDACTED_VALUE);
    expect(fact.evidence).toMatchObject({ file: 'Config.java', symbol: 'Config.appSecret', startLine: 12 });
    expect(JSON.stringify(fact)).not.toContain(secret);
    expect(fact.evidence.excerpt).toContain(REDACTED_VALUE);
  });

  it('redacts assignments, bearer headers and credential query parameters', () => {
    const text = 'apiKey = "fixture-api-key-123"; Authorization: Bearer fixture-token-456; url?app_id=fixture-app-id-789';
    const redacted = redactSensitiveText(text);
    expect(redacted).not.toContain('fixture-api-key-123');
    expect(redacted).not.toContain('fixture-token-456');
    expect(redacted).not.toContain('fixture-app-id-789');
    expect(redacted.match(/\[REDACTED\]/g)).toHaveLength(3);
  });
});
