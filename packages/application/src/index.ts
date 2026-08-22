import { Injectable, Module } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProjectConfig } from '@bizdoc/config';
import { newRunId, stableId, type BusinessFeature, type BusinessModelSnapshot, type CodeFact } from '@bizdoc/business-model';
import { ProjectScanner } from '@bizdoc/project-scanner';
import { FrontendAnalyzer } from '@bizdoc/analyzer-frontend';
import { SpringAnalyzer } from '@bizdoc/analyzer-spring';
import { FeatureLinker } from '@bizdoc/feature-linker';
import { Persistence } from '@bizdoc/persistence';
import { businessSnapshotSchema } from '@bizdoc/business-model';
import { createConfiguredComposer, EvidenceTemplateComposer } from '@bizdoc/ai-composer';
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
    const facts = [...new Map([...frontendFacts, ...backendFacts].map((fact) => [fact.id, fact])).values()];
    const linked = new FeatureLinker().link({ runId, facts, commits: { frontend: frontendSource.commit, backend: backendSource.commit }, mappings: config.analysis.mappings });
    const snapshot = businessSnapshotSchema.parse({ ...linked, diagnostics: { parseFailures: springAnalyzer.failures } });
    const metrics = { files: frontendSource.files.length + backendSource.files.length, facts: facts.length, features: snapshot.features.length,
      unlinkedFrontend: snapshot.unlinkedFrontendFactIds.length, unlinkedBackend: snapshot.unlinkedBackendFactIds.length,
      parseFailures: springAnalyzer.failures.length, durationMs: Date.now() - started };
    const outputDir = path.join(root, '.bizdoc', 'output', runId.replace(':', '-')); await mkdir(outputDir, { recursive: true });
    const output = path.join(outputDir, 'business-model.json'); await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    const persistence = new Persistence(root); persistence.migrate();
    persistence.saveAnalysis(stableId('project', config.project.name), config.project.name, config, runId, snapshot, metrics); persistence.close();
    return { snapshot, output, metrics };
  }
}

@Injectable()
export class GenerateDocumentUseCase {
  async execute(rootInput: string, featureId?: string, useAi = false): Promise<{ documents: DocumentationModel[]; paths: string[] }> {
    const root = path.resolve(rootInput); const persistence = new Persistence(root); persistence.migrate();
    const config = useAi ? await loadProjectConfig(root) : undefined;
    if (useAi && !config?.ai) { persistence.close(); throw new Error('AI provider is not configured in .bizdoc/project.yaml'); }
    const composer = useAi && config?.ai ? createConfiguredComposer(config.ai) : new EvidenceTemplateComposer();
    const snapshot = businessSnapshotSchema.parse(persistence.latestSnapshot());
    const features = featureId ? snapshot.features.filter((feature) => feature.id === featureId) : snapshot.features;
    if (!features.length) { persistence.close(); throw new Error(featureId ? `Feature not found: ${featureId}` : 'No linked features found'); }
    const documents: DocumentationModel[] = []; const paths: string[] = [];
    for (const feature of features) {
      const revision = persistence.nextRevision(documentId(feature.id));
      const composed = await composer.compose(feature, revision, useAi ? selectComposerFacts(feature, snapshot.facts) : undefined);
      const model = documentationModelSchema.parse({ ...composed, sourceSnapshotId: snapshot.id, sourceCommits: snapshot.commits });
      const outputDir = path.join(root, '.bizdoc', 'output', 'documents', model.id.replace(':', '-'), `revision-${revision}`); await mkdir(outputDir, { recursive: true });
      const markdownPath = path.join(outputDir, 'document.md'); await writeFile(markdownPath, new MarkdownRenderer().render(model));
      persistence.saveDocument(model, model.reviewItems.some((item) => item.severity === 'blocking') ? 'needs_review' : 'draft', markdownPath);
      documents.push(model); paths.push(markdownPath);
    }
    persistence.close(); return { documents, paths };
  }
}

@Injectable()
export class ReviewDocumentUseCase {
  execute(rootInput: string, documentId: string, revision: number): void {
    const persistence = new Persistence(path.resolve(rootInput)); persistence.migrate(); persistence.approveDocument(documentId, revision); persistence.close();
  }
}

@Injectable()
export class AttachScreenshotUseCase {
  async execute(rootInput: string, documentId: string, sectionId: string, file: string, alt: string): Promise<{ assetId: string; markdownPath: string }> {
    const root = path.resolve(rootInput); const persistence = new Persistence(root); persistence.migrate();
    const current = persistence.getDocument(documentId); const model = documentationModelSchema.parse(current.model);
    const manager = new ScreenshotManager(); const imported = await manager.import(root, file); const assetId = persistence.saveAsset(imported);
    const revision = persistence.nextRevision(documentId); const updated = { ...manager.attach(model, sectionId, assetId, alt), revision, reviewItems: [...model.reviewItems, { id: `${documentId}:review:screenshot:${revision}`, sectionId, message: '请确认截图与操作步骤一致且不包含敏感数据。', severity: 'blocking' as const }] };
    const outputDir = path.join(root, '.bizdoc', 'output', 'documents', documentId.replace(':', '-'), `revision-${revision}`); await mkdir(outputDir, { recursive: true });
    const markdownPath = path.join(outputDir, 'document.md'); const relative = path.relative(outputDir, imported.path);
    await writeFile(markdownPath, new MarkdownRenderer().render(updated, { [assetId]: relative })); persistence.saveDocument(updated, 'needs_review', markdownPath); persistence.close();
    return { assetId, markdownPath };
  }
}

export class PublishDocumentUseCase {
  async execute(rootInput: string, documentIdValue: string, targetId: string, publisher: Publisher): Promise<PublishResult> {
    const persistence = new Persistence(path.resolve(rootInput)); persistence.migrate(); const current = persistence.getDocument(documentIdValue);
    if (current.status !== 'approved') { persistence.close(); throw new Error(`REVIEW_REQUIRED: ${documentIdValue} revision ${current.revision} is ${current.status}`); }
    const document = documentationModelSchema.parse(current.model); const existing = persistence.publicationMapping(document.id, targetId);
    const startedAt = new Date().toISOString();
    try {
      const result = await publisher.publish({ document, targetId, assets: persistence.assets(), ...(existing ? { existing } : {}) });
      persistence.savePublication({ id: `publication:${randomUUID()}`, documentId: document.id, revision: document.revision, targetId, nodeToken: result.nodeToken, documentToken: result.documentToken, status: 'completed', result, startedAt, finishedAt: new Date().toISOString() });
      persistence.close(); return result;
    } catch (error) {
      persistence.savePublication({ id: `publication:${randomUUID()}`, documentId: document.id, revision: document.revision, targetId, status: 'failed', ...(error instanceof PublishError ? { errorCategory: error.category, ...(error.nodeToken ? { nodeToken: error.nodeToken } : {}), ...(error.documentToken ? { documentToken: error.documentToken } : {}) } : {}), result: { message: error instanceof Error ? error.message : String(error) }, startedAt, finishedAt: new Date().toISOString() });
      persistence.close(); throw error;
    }
  }
}

@Module({ providers: [HealthService, AnalyzeProjectUseCase, GenerateDocumentUseCase, ReviewDocumentUseCase, AttachScreenshotUseCase, PublishDocumentUseCase], exports: [HealthService, AnalyzeProjectUseCase, GenerateDocumentUseCase, ReviewDocumentUseCase, AttachScreenshotUseCase, PublishDocumentUseCase] })
export class ApplicationModule {}
