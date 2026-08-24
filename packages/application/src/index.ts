import { Injectable, Module } from '@nestjs/common';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProjectConfig } from '@bizdoc/config';
import { newRunId, stableId, type BusinessFeature, type BusinessModelSnapshot, type CodeFact } from '@bizdoc/business-model';
import { ProjectScanner } from '@bizdoc/project-scanner';
import { FrontendAnalyzer } from '@bizdoc/analyzer-frontend';
import { SpringAnalyzer } from '@bizdoc/analyzer-spring';
import { FeatureLinker } from '@bizdoc/feature-linker';
import { Persistence } from '@bizdoc/persistence';
import { businessSnapshotSchema, redactSensitiveText, sanitizeCodeFacts } from '@bizdoc/business-model';
import { createConfiguredComposer, EvidenceTemplateComposer, type CredentialLookup } from '@bizdoc/ai-composer';
import { documentId, documentationModelSchema, type DocumentationModel } from '@bizdoc/document-model';
import { MarkdownRenderer } from '@bizdoc/markdown-renderer';
import { ScreenshotManager } from '@bizdoc/screenshot-manager';
import { PublishError, type Publisher, type PublishResult } from '@bizdoc/publisher';
import { randomUUID } from 'node:crypto';

@Injectable()
export class HealthService {
  status(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

const COMPOSER_FACT_PRIORITY: Partial<Record<CodeFact['kind'], number>> = {
  STATE_CHANGE: 0, CONDITION: 1, VALIDATION: 2, EXCEPTION: 3, MESSAGE: 4, ACTION: 5,
  FORM_FIELD: 6, SERVICE_CALL: 7, API_CALL: 8, HTTP_ENDPOINT: 9
};

function conditionPriority(fact: CodeFact): number {
  if (fact.kind !== 'CONDITION') return 0;
  const value = fact.value ?? fact.name;
  if (/customerId/.test(value)) return 0;
  if (/conversionCode/.test(value)) return 1;
  if (/step1Intent/.test(value)) return 2;
  if (/customerMode/.test(value)) return 3;
  if (/customerDetail/.test(value)) return 4;
  return 20;
}

export function selectComposerFacts(feature: BusinessFeature, facts: CodeFact[], limit = 18): CodeFact[] {
  const directIds = new Set([...feature.frontendRefs, ...feature.backendRefs]);
  const frontendFiles = new Set(facts.filter((fact) => feature.frontendRefs.includes(fact.id)).map((fact) => fact.evidence.file));
  const frontendDirectories = new Set([...frontendFiles].map((file) => path.posix.dirname(file)));
  return facts
    .filter((fact) => directIds.has(fact.id) || frontendFiles.has(fact.evidence.file)
      || (frontendDirectories.has(path.posix.dirname(fact.evidence.file)) && ['CONDITION', 'STATE_CHANGE', 'MESSAGE', 'ACTION'].includes(fact.kind)))
    .sort((left, right) => {
      const leftDirectFrontend = feature.frontendRefs.includes(left.id) ? 0 : 1;
      const rightDirectFrontend = feature.frontendRefs.includes(right.id) ? 0 : 1;
      return leftDirectFrontend - rightDirectFrontend
        || (COMPOSER_FACT_PRIORITY[left.kind] ?? 20) - (COMPOSER_FACT_PRIORITY[right.kind] ?? 20)
        || conditionPriority(left) - conditionPriority(right)
        || (left.evidence.startLine ?? 0) - (right.evidence.startLine ?? 0);
    })
    .slice(0, limit);
}

@Injectable()
export class AnalyzeProjectUseCase {
  async execute(rootInput: string): Promise<{ snapshot: BusinessModelSnapshot; output: string; metrics: Record<string, number> }> {
    const started = Date.now(); const root = path.resolve(rootInput); const config = await loadProjectConfig(root);
    const inventory = await new ProjectScanner().scan(root, config);
    const frontendSource = inventory.sources.find((source) => source.name === 'frontend');
    const backendSource = inventory.sources.find((source) => source.name === 'backend');
    if (!frontendSource || !backendSource) throw new Error('Both frontend and backend sources are required');
    if (!frontendSource.files.length || !backendSource.files.length) {
      throw new Error(`No analyzable source files found (frontend: ${frontendSource.files.length}, backend: ${backendSource.files.length}); check analysis.include and source paths`);
    }
    const springAnalyzer = new SpringAnalyzer();
    const [frontendFacts, backendFacts] = await Promise.all([new FrontendAnalyzer().analyze(frontendSource), springAnalyzer.analyze(backendSource)]);
    const runId = newRunId();
    const facts = sanitizeCodeFacts([...new Map([...frontendFacts, ...backendFacts].map((fact) => [fact.id, fact])).values()]);
    const linked = new FeatureLinker().link({ runId, facts, commits: { frontend: frontendSource.commit, backend: backendSource.commit }, mappings: config.analysis.mappings });
    const snapshot = businessSnapshotSchema.parse({ ...linked, diagnostics: { parseFailures: springAnalyzer.failures } });
    const metrics = { files: frontendSource.files.length + backendSource.files.length, facts: facts.length, features: snapshot.features.length,
      unlinkedFrontend: snapshot.unlinkedFrontendFactIds.length, unlinkedBackend: snapshot.unlinkedBackendFactIds.length,
      parseFailures: springAnalyzer.failures.length, durationMs: Date.now() - started };
    const outputDir = path.join(root, '.bizdoc', 'output', runId.replace(':', '-')); await mkdir(outputDir, { recursive: true });
    const output = path.join(outputDir, 'business-model.json'); await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    const persistence = new Persistence(root);
    try { persistence.migrate(); persistence.saveAnalysis(stableId('project', config.project.name), config.project.name, config, runId, snapshot, metrics); }
    finally { persistence.close(); }
    return { snapshot, output, metrics };
  }
}

@Injectable()
export class GenerateDocumentUseCase {
  async execute(rootInput: string, featureId?: string, useAi = false, options: { credentialLookup?: CredentialLookup; moduleName?: string; moduleId?: string } = {}): Promise<{ documents: DocumentationModel[]; paths: string[] }> {
    const root = path.resolve(rootInput); const persistence = new Persistence(root);
    try {
      persistence.migrate();
      const config = await loadProjectConfig(root);
      if (useAi && !config.ai) throw new Error('AI provider is not configured in .bizdoc/project.yaml');
      const composer = useAi && config.ai ? createConfiguredComposer(config.ai, options.credentialLookup) : new EvidenceTemplateComposer();
      const snapshot = businessSnapshotSchema.parse(persistence.latestSnapshot());
      const features = featureId ? snapshot.features.filter((feature) => feature.id === featureId) : snapshot.features;
      if (!features.length) throw new Error(featureId ? `Feature not found: ${featureId}` : 'No linked features found');
      const documents: DocumentationModel[] = []; const paths: string[] = [];
      for (const feature of features) {
        const revision = persistence.nextRevision(documentId(feature.id));
        const composed = await composer.compose(feature, revision, useAi ? selectComposerFacts(feature, snapshot.facts) : undefined);
        const moduleName = options.moduleName ?? config.publishing?.feishu?.default_module ?? '未分类';
        const model = documentationModelSchema.parse({
          ...composed,
          classification: {
            system: { id: stableId('system', config.project.name), name: config.project.display_name ?? config.project.name },
            module: { id: options.moduleId ?? stableId('module', config.project.name, moduleName), name: moduleName }
          },
          sourceSnapshotId: snapshot.id, sourceCommits: snapshot.commits
        });
        const outputDir = path.join(root, '.bizdoc', 'output', 'documents', model.id.replace(':', '-'), `revision-${revision}`); await mkdir(outputDir, { recursive: true });
        const markdownPath = path.join(outputDir, 'document.md'); await writeFile(markdownPath, new MarkdownRenderer().render(model));
        persistence.saveDocument(model, model.reviewItems.some((item) => item.severity === 'blocking') ? 'needs_review' : 'draft', markdownPath);
        documents.push(model); paths.push(markdownPath);
      }
      return { documents, paths };
    } finally { persistence.close(); }
  }
}

@Injectable()
export class ClassifyDocumentUseCase {
  async execute(rootInput: string, documentIdValue: string, moduleNameInput: string, moduleId?: string): Promise<{ document: DocumentationModel; markdownPath: string; status: 'needs_review' }> {
    const root = path.resolve(rootInput); const persistence = new Persistence(root);
    try {
      persistence.migrate();
      const current = persistence.getDocument(documentIdValue);
      const storedModel = current.model as { classification?: { system?: { name?: unknown }; module?: { name?: unknown } } };
      const storedClassification = storedModel.classification;
      const storedModuleName = typeof storedClassification?.module?.name === 'string' ? storedClassification.module.name.trim() : '';
      if (storedClassification && storedModuleName && storedModuleName !== '未分类') {
        const classified = documentationModelSchema.parse(current.model);
        throw new Error(`DOCUMENT_ALREADY_CLASSIFIED: ${documentIdValue} is already assigned to ${classified.classification!.system.name}/${classified.classification!.module.name}`);
      }
      if (current.status !== 'approved') throw new Error(`REVIEW_REQUIRED: ${documentIdValue} revision ${current.revision} is ${current.status}`);
      const normalizedStoredModel = storedClassification && !storedModuleName
        ? { ...storedModel, classification: { ...storedClassification, module: { ...storedClassification.module, name: '未分类' } } }
        : storedModel;
      const model = documentationModelSchema.parse(normalizedStoredModel);
      const moduleName = moduleNameInput.trim();
      if (!moduleName || moduleName === '未分类') throw new Error('A confirmed business module name is required; "未分类" cannot be published');
      const explicitModuleId = moduleId?.trim();
      if (moduleId !== undefined && !explicitModuleId) throw new Error('A non-empty --module-id is required when the option is provided');
      const assets = persistence.assets();
      const referencedAssetIds = new Set(model.steps.flatMap((step) => step.screenshots.map((screenshot) => screenshot.assetId)));
      const availableAssetPaths = new Map<string, string>();
      for (const assetId of referencedAssetIds) {
        const asset = assets[assetId];
        if (!asset) throw new Error(`SCREENSHOT_ASSET_MISSING: ${assetId} is not registered`);
        const assetPath = path.isAbsolute(asset.path) ? asset.path : path.resolve(root, asset.path);
        try {
          if (!(await stat(assetPath)).isFile()) throw new Error('not a file');
        } catch {
          throw new Error(`SCREENSHOT_ASSET_UNAVAILABLE: ${assetId} is missing or unreadable`);
        }
        availableAssetPaths.set(assetId, assetPath);
      }
      const config = await loadProjectConfig(root); const revision = persistence.nextRevision(documentIdValue);
      const classification = {
        system: { id: stableId('system', config.project.name), name: config.project.display_name ?? config.project.name },
        module: { id: explicitModuleId ?? stableId('module', config.project.name, moduleName), name: moduleName }
      };
      const document = documentationModelSchema.parse({
        ...model, classification, revision,
        reviewItems: [...model.reviewItems, {
          id: `${documentIdValue}:review:classification:${revision}`, sectionId: documentIdValue,
          message: `请确认文档归属 ${classification.system.name}/${classification.module.name}。`, severity: 'blocking'
        }]
      });
      const outputDir = path.join(root, '.bizdoc', 'output', 'documents', documentIdValue.replace(':', '-'), `revision-${revision}`); await mkdir(outputDir, { recursive: true });
      const markdownPath = path.join(outputDir, 'document.md');
      const assetPaths = Object.fromEntries([...availableAssetPaths].map(([id, assetPath]) => [id, path.relative(outputDir, assetPath)]));
      await writeFile(markdownPath, new MarkdownRenderer().render(document, assetPaths));
      persistence.saveDocument(document, 'needs_review', markdownPath);
      return { document, markdownPath, status: 'needs_review' };
    } finally { persistence.close(); }
  }
}

@Injectable()
export class ReviewDocumentUseCase {
  execute(rootInput: string, documentId: string, revision: number): void {
    const persistence = new Persistence(path.resolve(rootInput));
    try { persistence.migrate(); persistence.approveDocument(documentId, revision); } finally { persistence.close(); }
  }
}

@Injectable()
export class AttachScreenshotUseCase {
  async execute(rootInput: string, documentId: string, sectionId: string, file: string, alt: string): Promise<{ assetId: string; markdownPath: string; revision: number }> {
    const root = path.resolve(rootInput); const persistence = new Persistence(root);
    try {
      persistence.migrate();
      const current = persistence.getDocument(documentId); const model = documentationModelSchema.parse(current.model);
      if (!model.steps.some((step) => step.id === sectionId)) throw new Error(`Document section not found: ${sectionId}`);
      const manager = new ScreenshotManager(); const imported = await manager.import(root, file); const assetId = persistence.saveAsset(imported);
      const revision = persistence.nextRevision(documentId); const updated = { ...manager.attach(model, sectionId, assetId, alt), revision, reviewItems: [...model.reviewItems, { id: `${documentId}:review:screenshot:${revision}`, sectionId, message: '请确认截图与操作步骤一致且不包含敏感数据。', severity: 'blocking' as const }] };
      const outputDir = path.join(root, '.bizdoc', 'output', 'documents', documentId.replace(':', '-'), `revision-${revision}`); await mkdir(outputDir, { recursive: true });
      const markdownPath = path.join(outputDir, 'document.md');
      const assetPaths = Object.fromEntries(Object.entries(persistence.assets()).map(([id, asset]) => [id, path.relative(outputDir, asset.path)]));
      await writeFile(markdownPath, new MarkdownRenderer().render(updated, assetPaths)); persistence.saveDocument(updated, 'needs_review', markdownPath);
      return { assetId, markdownPath, revision };
    } finally {
      persistence.close();
    }
  }
}

export class PublishDocumentUseCase {
  async execute(rootInput: string, documentIdValue: string, targetId: string, publisher: Publisher): Promise<PublishResult> {
    const persistence = new Persistence(path.resolve(rootInput));
    try {
      persistence.migrate(); const current = persistence.getDocument(documentIdValue);
      if (current.status !== 'approved') throw new Error(`REVIEW_REQUIRED: ${documentIdValue} revision ${current.revision} is ${current.status}`);
      const document = documentationModelSchema.parse(current.model); const existing = persistence.publicationMapping(document.id, targetId);
      if (persistence.unresolvedBlockingReviewItems(document.id, document.revision).length > 0) throw new Error(`REVIEW_REQUIRED: ${documentIdValue} revision ${current.revision} has blocking review items`);
      const startedAt = new Date().toISOString();
      try {
        const result = await publisher.publish({ document, targetId, assets: persistence.assets(), ...(existing ? { existing } : {}) });
        persistence.savePublication({ id: `publication:${randomUUID()}`, documentId: document.id, revision: document.revision, targetId, nodeToken: result.nodeToken, documentToken: result.documentToken, status: 'completed', result, startedAt, finishedAt: new Date().toISOString() });
        return result;
      } catch (error) {
        persistence.savePublication({ id: `publication:${randomUUID()}`, documentId: document.id, revision: document.revision, targetId, status: 'failed', ...(error instanceof PublishError ? { errorCategory: error.category, ...(error.nodeToken ? { nodeToken: error.nodeToken } : {}), ...(error.documentToken ? { documentToken: error.documentToken } : {}) } : {}), result: { message: redactSensitiveText(error instanceof Error ? error.message : String(error)) }, startedAt, finishedAt: new Date().toISOString() });
        throw error;
      }
    } finally { persistence.close(); }
  }
}

@Module({ providers: [HealthService, AnalyzeProjectUseCase, GenerateDocumentUseCase, ClassifyDocumentUseCase, ReviewDocumentUseCase, AttachScreenshotUseCase, PublishDocumentUseCase], exports: [HealthService, AnalyzeProjectUseCase, GenerateDocumentUseCase, ClassifyDocumentUseCase, ReviewDocumentUseCase, AttachScreenshotUseCase, PublishDocumentUseCase] })
export class ApplicationModule {}
