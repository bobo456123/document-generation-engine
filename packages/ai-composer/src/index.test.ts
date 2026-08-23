import { describe, expect, it } from 'vitest';
import { composerPromptInput, createConfiguredComposer, EvidenceTemplateComposer, repairStructuredDocumentText, requireAiReview, retryStructuredComposition, validateComposedDocument } from './index.js';
import { docContentSchema, documentId, documentationModelSchema } from '@bizdoc/document-model';

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

  it('accepts evidence facts that were explicitly included in the model prompt', async () => {
    const valid = await new EvidenceTemplateComposer().compose(feature, 1);
    const supplemental = {
      id: 'fact:supplemental', kind: 'CONDITION' as const, name: 'eligible', confidence: 'verified' as const,
      evidence: { id: 'evidence:supplemental', source: 'SOURCE_CODE' as const, file: 'src/lead.ts', excerpt: 'eligible' }
    };
    expect(() => validateComposedDocument(feature, 1, {
      ...valid,
      notices: [{ text: 'eligible', evidenceIds: ['evidence:supplemental'], confidence: 'verified' }]
    }, [supplemental])).not.toThrow();
  });

  it('rejects verified claims backed by AI inference evidence', async () => {
    const valid = await new EvidenceTemplateComposer().compose(feature, 1);
    const fact = {
      id: 'fact:inference', kind: 'CONDITION' as const, name: 'assumed condition', confidence: 'inferred' as const,
      evidence: { id: 'evidence:a1', source: 'AI_INFERENCE' as const, file: 'virtual', excerpt: 'assumed' }
    };
    expect(() => validateComposedDocument(feature, 1, { ...valid, summary: { text: 'assumed', evidenceIds: ['evidence:a1'], confidence: 'verified' } }, [fact]))
      .toThrow('promoted AI_INFERENCE');
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

  it('redacts unsafe facts before constructing model input', () => {
    const secret = 'fixture-model-secret-123456';
    const input = composerPromptInput(feature, 1, [{
      id: 'fact:secret', kind: 'STATE_CHANGE', name: 'appSecret', value: secret, confidence: 'verified',
      evidence: { id: 'evidence:a1', source: 'SOURCE_CODE', file: 'Config.ts', symbol: 'appSecret', excerpt: `const appSecret = '${secret}'` }
    }]);
    expect(JSON.stringify(input)).not.toContain(secret);
    expect(JSON.stringify(input)).toContain('[REDACTED]');
  });

  it('always puts AI output behind a blocking human review', async () => {
    const candidate = await new EvidenceTemplateComposer().compose(feature, 1);
    const withoutReview = { ...candidate, reviewItems: [] };
    expect(requireAiReview(withoutReview).reviewItems).toContainEqual(expect.objectContaining({ severity: 'blocking' }));
  });

  it('repairs only mechanically omitted document containers and step titles', async () => {
    const candidate = await new EvidenceTemplateComposer().compose(feature, 1);
    const withoutFields = { ...candidate } as Partial<typeof candidate>;
    delete withoutFields.fields;
    const withoutTitles = { ...withoutFields, steps: candidate.steps.map((step) => {
      const withoutTitle = { ...step } as Partial<typeof step>;
      delete withoutTitle.title;
      return withoutTitle;
    }) };
    const repairedText = await repairStructuredDocumentText({ text: JSON.stringify(withoutTitles), error: new Error('schema') });
    expect(repairedText).not.toBeNull();
    expect(JSON.parse(repairedText ?? '{}')).toMatchObject({ fields: [], steps: [{ title: '步骤 1' }] });
    expect(documentationModelSchema.safeParse(JSON.parse(repairedText ?? '{}')).success).toBe(true);
  });

  it('does not invent a repair for invalid JSON', async () => {
    await expect(repairStructuredDocumentText({ text: 'not-json', error: new Error('parse') })).resolves.toBeNull();
  });

  it('retries structured composition a finite number of times', async () => {
    let calls = 0;
    await expect(retryStructuredComposition(async () => {
      calls += 1;
      if (calls < 3) throw new Error('invalid schema');
      return 'valid';
    })).resolves.toBe('valid');
    expect(calls).toBe(3);

    calls = 0;
    await expect(retryStructuredComposition(async () => {
      calls += 1;
      throw new Error(`invalid ${calls}`);
    }, 2)).rejects.toThrow('invalid 2');
    expect(calls).toBe(2);
  });
});
