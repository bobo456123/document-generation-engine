import { generateObject, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { sanitizeCodeFact, type BusinessFeature, type CodeFact } from '@bizdoc/business-model';
import { documentId, documentationModelSchema, type DocumentationModel } from '@bizdoc/document-model';
import type { ProjectConfig } from '@bizdoc/config';

export interface DocumentComposer { compose(feature: BusinessFeature, revision: number, evidenceFacts?: CodeFact[]): Promise<DocumentationModel> }

const AI_COMPOSE_ATTEMPTS = 3;

export async function retryStructuredComposition<T>(operation: () => Promise<T>, attempts = AI_COMPOSE_ATTEMPTS): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('AI composition attempts must be a positive integer');
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) { lastError = error; }
  }
  throw lastError;
}

export function composerPromptInput(feature: BusinessFeature, revision: number, evidenceFacts: CodeFact[] = []): unknown {
  return {
    feature,
    evidenceFacts: evidenceFacts.map(sanitizeCodeFact).map((fact) => ({
      ...fact,
      evidence: {
        id: fact.evidence.id,
        source: fact.evidence.source,
        file: fact.evidence.file,
        ...(fact.evidence.symbol ? { symbol: fact.evidence.symbol } : {}),
        ...(fact.evidence.startLine ? { startLine: fact.evidence.startLine } : {}),
        ...(fact.evidence.endLine ? { endLine: fact.evidence.endLine } : {}),
        ...(fact.evidence.excerpt ? { excerpt: fact.evidence.excerpt.slice(0, 600) } : {})
      }
    })),
    documentId: documentId(feature.id), revision
  };
}

export function requireAiReview(document: DocumentationModel): DocumentationModel {
  if (document.reviewItems.some((item) => item.severity === 'blocking')) return document;
  return documentationModelSchema.parse({
    ...document,
    reviewItems: [...document.reviewItems, {
      id: `${document.id}:review:ai-source`, sectionId: document.id,
      message: 'AI 生成内容必须由熟悉业务和源码的人员复核后才能发布。', severity: 'blocking'
    }]
  });
}

export function validateComposedDocument(feature: BusinessFeature, revision: number, candidate: unknown, evidenceFacts: CodeFact[] = []): DocumentationModel {
  const parsed = documentationModelSchema.parse(candidate);
  const allowed = new Set([...feature.evidenceIds, ...evidenceFacts.map((fact) => fact.evidence.id)]);
  const references = JSON.stringify(parsed).match(/evidence:[a-f0-9]+/g) ?? [];
  const invalid = references.filter((id) => !allowed.has(id));
  if (invalid.length) throw new Error(`Model returned unknown evidence IDs: ${[...new Set(invalid)].join(', ')}`);
  if (parsed.id !== documentId(feature.id) || parsed.featureId !== feature.id || parsed.revision !== revision) throw new Error('Model changed immutable document identity or revision fields');
  const inferenceEvidence = new Set(evidenceFacts.filter((fact) => fact.evidence.source === 'AI_INFERENCE').map((fact) => fact.evidence.id));
  const contents = [
    ...(parsed.summary ? [parsed.summary] : []), ...parsed.roles, ...parsed.scenarios,
    ...parsed.steps.map((step) => step.instruction), ...parsed.fields.map((field) => field.description),
    ...parsed.outcomes, ...parsed.notices, ...parsed.faqs.map((faq) => faq.answer)
  ];
  if (contents.some((content) => content.confidence === 'verified' && content.evidenceIds.some((id) => inferenceEvidence.has(id)))) {
    throw new Error('Model promoted AI_INFERENCE evidence to verified content');
  }
  return parsed;
}

export async function repairStructuredDocumentText({ text }: { text: string; error: unknown }): Promise<string | null> {
  let candidate: unknown;
  try { candidate = JSON.parse(text); } catch { return null; }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const repaired = { ...candidate } as Record<string, unknown>;
  for (const key of ['roles', 'scenarios', 'fields', 'outcomes', 'notices', 'faqs', 'relatedFeatureIds', 'reviewItems']) {
    if (repaired[key] === undefined) repaired[key] = [];
  }
  if (Array.isArray(repaired.steps)) {
    repaired.steps = repaired.steps.map((step, index) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
      const value = step as Record<string, unknown>;
      return value.title === undefined ? { ...value, title: `步骤 ${index + 1}` } : value;
    });
  }
  return JSON.stringify(repaired);
}

export class EvidenceTemplateComposer implements DocumentComposer {
  async compose(feature: BusinessFeature, revision: number): Promise<DocumentationModel> {
    const id = documentId(feature.id);
    const evidenceIds = feature.evidenceIds;
    return documentationModelSchema.parse({
      id, featureId: feature.id, title: feature.name,
      summary: { text: `通过 ${feature.apiRefs.map((api) => `${api.method} ${api.path}`).join('、')} 完成该功能。`, evidenceIds, confidence: feature.confidence === 'verified' ? 'verified' : 'inferred' },
      roles: feature.roles.map((role) => ({ text: role.value, evidenceIds: role.evidenceIds, confidence: 'verified' })), scenarios: [],
      steps: [{ id: `${id}:step:1`, title: '执行操作', instruction: { text: `在系统中执行“${feature.name}”操作并提交。`, evidenceIds, confidence: 'inferred' }, screenshots: [] }],
      fields: feature.fields.map((field) => ({ name: field.name, ...(field.required === undefined ? {} : { required: field.required }), description: { text: field.required ? '必填字段。' : '业务字段。', evidenceIds: field.evidenceIds, confidence: 'verified' } })),
      outcomes: feature.outcomes.map((outcome) => ({ text: outcome.value, evidenceIds: outcome.evidenceIds, confidence: 'verified' })),
      notices: feature.rules.map((rule) => ({ text: rule.text, evidenceIds: rule.evidenceIds, confidence: 'verified' })), faqs: [], relatedFeatureIds: [],
      reviewItems: [{ id: `${id}:review:steps`, sectionId: `${id}:step:1`, message: '操作步骤由静态事实归纳，需要人工确认页面入口、点击顺序和结果。', severity: 'blocking' }], revision
    });
  }
}

export class AiDocumentComposer implements DocumentComposer {
  constructor(private readonly model: LanguageModel) {}
  async compose(feature: BusinessFeature, revision: number, evidenceFacts: CodeFact[] = []): Promise<DocumentationModel> {
    return retryStructuredComposition(async () => {
      const { object } = await generateObject({
        model: this.model, schema: documentationModelSchema, maxRetries: 2,
        repairText: repairStructuredDocumentText,
        system: '你是业务操作文档编写器。只能使用输入事实。内容务必简洁。无法证明的内容留空或加入 reviewItems，禁止虚构角色、条件、金额、权限或结果。所有 Schema 必填字段必须返回；没有内容的数组返回空数组；不可变 ID 和 revision 必须原样复制输入。',
        prompt: JSON.stringify(composerPromptInput(feature, revision, evidenceFacts))
      });
      return requireAiReview(validateComposedDocument(feature, revision, object, evidenceFacts));
    });
  }
}

export type CredentialLookup = (name: string) => string | undefined;

function requiredCredential(name: string, lookup: CredentialLookup): string {
  const value = lookup(name); if (!value) throw new Error(`${name} is required for the configured AI provider`); return value;
}

export function createConfiguredComposer(config: NonNullable<ProjectConfig['ai']>, lookup: CredentialLookup = (name) => process.env[name]): AiDocumentComposer {
  if (config.provider === 'openai') {
    return new AiDocumentComposer(createOpenAI({ apiKey: requiredCredential('OPENAI_API_KEY', lookup), ...(config.base_url ? { baseURL: config.base_url } : {}) })(config.model));
  }
  if (config.provider === 'anthropic') {
    return new AiDocumentComposer(createAnthropic({ apiKey: requiredCredential('ANTHROPIC_API_KEY', lookup), ...(config.base_url ? { baseURL: config.base_url } : {}) })(config.model));
  }
  const settings = config.provider === 'deepseek'
    ? { name: 'deepseek', apiKey: requiredCredential('DEEPSEEK_API_KEY', lookup), baseURL: config.base_url ?? 'https://api.deepseek.com/v1' }
    : config.provider === 'qwen'
      ? { name: 'qwen', apiKey: requiredCredential('DASHSCOPE_API_KEY', lookup), baseURL: config.base_url ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1' }
      : { name: 'openai-compatible', apiKey: requiredCredential('AI_API_KEY', lookup), baseURL: config.base_url ?? requiredCredential('AI_BASE_URL', lookup) };
  return new AiDocumentComposer(createOpenAICompatible(settings)(config.model));
}
