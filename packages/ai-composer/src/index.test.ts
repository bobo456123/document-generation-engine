import { describe, expect, it } from 'vitest';
import { composerPromptInput, createConfiguredComposer, EvidenceTemplateComposer, requireAiReview, validateComposedDocument } from './index.js';
import { docContentSchema, documentId } from '@bizdoc/document-model';

const feature = {
  id: 'feature:1', name: 'create', module: 'OpportunityController', roles: [], frontendRefs: ['f'], backendRefs: ['b'],
  apiRefs: [{ method: 'POST', path: '/api/opportunities', evidenceIds: ['evidence:a1'] }], entities: [], fields: [], rules: [], outcomes: [], confidence: 'verified' as const, evidenceIds: ['evidence:a1']
};

describe('EvidenceTemplateComposer', () => {
  it('keeps inferred steps behind a blocking review item', async () => {
    const document = await new EvidenceTemplateComposer().compose(feature, 1);
    expect(document.steps[0]?.instruction.confidence).toBe('inferred');
    expect(document.reviewItems.some((item) => item.severity === 'blocking')).toBe(true);
  });

  it('rejects verified content without evidence', () => {
    expect(docContentSchema.safeParse({ text: '无来源结论', evidenceIds: [], confidence: 'verified' }).success).toBe(false);
    expect(docContentSchema.safeParse({ text: '待确认推断', evidenceIds: [], confidence: 'inferred' }).success).toBe(true);
  });

  it('is deterministic for the same feature and revision', async () => {
    const composer = new EvidenceTemplateComposer();
    expect(await composer.compose(feature, 1)).toEqual(await composer.compose(feature, 1));
  });

  it('rejects model output with invented evidence or changed identity', async () => {
    const valid = await new EvidenceTemplateComposer().compose(feature, 1);
    expect(() => validateComposedDocument(feature, 1, { ...valid, summary: { text: 'invented', evidenceIds: ['evidence:bad'], confidence: 'verified' } }))
      .toThrow('unknown evidence IDs');
    expect(() => validateComposedDocument(feature, 1, { ...valid, id: documentId('feature:other') }))
      .toThrow('immutable document identity');
  });

  it('creates an Anthropic-compatible composer from an environment-only key', () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = 'test-only';
      expect(createConfiguredComposer({ provider: 'anthropic', model: 'glm-test', base_url: 'https://ai.example.test/v1' })).toBeInstanceOf(Object);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it('removes repository paths from evidence sent to the model', () => {
    const input = composerPromptInput(feature, 1, [{
      id: 'fact:1', kind: 'CONDITION', name: 'eligible', confidence: 'verified',
      evidence: { id: 'evidence:a1', source: 'SOURCE_CODE', repository: '/private/crm', file: 'src/lead.ts', startLine: 10, excerpt: 'status === pending' }
    }]);
    expect(JSON.stringify(input)).toContain('status === pending');
    expect(JSON.stringify(input)).not.toContain('/private/crm');
  });

  it('always puts AI output behind a blocking human review', async () => {
    const candidate = await new EvidenceTemplateComposer().compose(feature, 1);
    const withoutReview = { ...candidate, reviewItems: [] };
    expect(requireAiReview(withoutReview).reviewItems).toContainEqual(expect.objectContaining({ severity: 'blocking' }));
  });
});
