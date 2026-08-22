import { generateObject, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { BusinessFeature, CodeFact } from '@bizdoc/business-model';
import { documentId, documentationModelSchema, type DocumentationModel } from '@bizdoc/document-model';
import type { ProjectConfig } from '@bizdoc/config';

export interface DocumentComposer { compose(feature: BusinessFeature, revision: number, evidenceFacts?: CodeFact[]): Promise<DocumentationModel> }

export function composerPromptInput(feature: BusinessFeature, revision: number, evidenceFacts: CodeFact[] = []): unknown {
  return {
    feature,
    evidenceFacts: evidenceFacts.map((fact) => ({
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

export function validateComposedDocument(feature: BusinessFeature, revision: number, candidate: unknown): DocumentationModel {
  const parsed = documentationModelSchema.parse(candidate);
  const allowed = new Set(feature.evidenceIds);
  const references = JSON.stringify(parsed).match(/evidence:[a-f0-9]+/g) ?? [];
  const invalid = references.filter((id) => !allowed.has(id));
  if (invalid.length) throw new Error(`Model returned unknown evidence IDs: ${[...new Set(invalid)].join(', ')}`);
  if (parsed.id !== documentId(feature.id) || parsed.featureId !== feature.id || parsed.revision !== revision) throw new Error('Model changed immutable document identity or revision fields');
  return parsed;
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
    const { object } = await generateObject({
      model: this.model, schema: documentationModelSchema, maxRetries: 2,
      system: '你是业务操作文档编写器。只能使用输入事实。内容务必简洁。无法证明的内容留空或加入 reviewItems，禁止虚构角色、条件、金额、权限或结果。',
      prompt: JSON.stringify(composerPromptInput(feature, revision, evidenceFacts))
    });
    return requireAiReview(validateComposedDocument(feature, revision, object));
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]; if (!value) throw new Error(`${name} is required for the configured AI provider`); return value;
}

export function createConfiguredComposer(config: NonNullable<ProjectConfig['ai']>): AiDocumentComposer {
  if (config.provider === 'openai') {
    return new AiDocumentComposer(createOpenAI({ apiKey: requiredEnvironment('OPENAI_API_KEY'), ...(config.base_url ? { baseURL: config.base_url } : {}) })(config.model));
  }
  if (config.provider === 'anthropic') {
    return new AiDocumentComposer(createAnthropic({ apiKey: requiredEnvironment('ANTHROPIC_API_KEY'), ...(config.base_url ? { baseURL: config.base_url } : {}) })(config.model));
  }
  const settings = config.provider === 'deepseek'
    ? { name: 'deepseek', apiKey: requiredEnvironment('DEEPSEEK_API_KEY'), baseURL: config.base_url ?? 'https://api.deepseek.com/v1' }
    : config.provider === 'qwen'
      ? { name: 'qwen', apiKey: requiredEnvironment('DASHSCOPE_API_KEY'), baseURL: config.base_url ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1' }
      : { name: 'openai-compatible', apiKey: requiredEnvironment('AI_API_KEY'), baseURL: config.base_url ?? requiredEnvironment('AI_BASE_URL') };
  return new AiDocumentComposer(createOpenAICompatible(settings)(config.model));
}
