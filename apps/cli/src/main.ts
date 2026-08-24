#!/usr/bin/env node
import 'reflect-metadata';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Argument, Command } from 'commander';
import YAML from 'yaml';
import { AppModule } from '../../server/src/app.module.js';
import {
  CredentialStore, credentialNamesByTarget, defaultProjectConfig, loadProjectConfig, requiredAiCredentialNames, resolveWorkspaceRoot,
  type CredentialName, type CredentialTarget
} from '@bizdoc/config';
import { businessSnapshotSchema, type BusinessFeature } from '@bizdoc/business-model';
import { Persistence } from '@bizdoc/persistence';
import { AnalyzeProjectUseCase, AttachScreenshotUseCase, ClassifyDocumentUseCase, GenerateDocumentUseCase, PublishDocumentUseCase, ReviewDocumentUseCase } from '@bizdoc/application';
import { startLocalPreview } from '@bizdoc/markdown-renderer';
import { FeishuHierarchyResolver, FeishuPublisher, FeishuSdkClient, preflightFeishuPublish } from '@bizdoc/publisher-feishu';
import type { Publisher } from '@bizdoc/publisher';
import { documentId as documentIdForFeature, documentationModelSchema } from '@bizdoc/document-model';
import { askText, chooseOne, confirm, terminalPromptIO } from './interactive.js';
import { captureScreenshot, chooseScreenshotFile } from './screenshot-input.js';

type AppContext = INestApplicationContext;
type DocumentRecord = ReturnType<Persistence['listDocuments']>[number];
const CLI_VERSION = '0.1.1';

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

async function initProject(directory: string | undefined, systemName?: string): Promise<void> {
  const root = path.resolve(directory ?? '.');
  const work = path.join(root, '.bizdoc'); const configFile = path.join(work, 'project.yaml');
  if (await exists(configFile)) throw new Error(`Configuration already exists: ${configFile}`);
  await mkdir(path.join(work, 'assets'), { recursive: true }); await mkdir(path.join(work, 'output'), { recursive: true }); await mkdir(path.join(work, 'logs'), { recursive: true });
  await writeFile(configFile, YAML.stringify(defaultProjectConfig(path.basename(root), systemName)), { flag: 'wx' });
  const persistence = new Persistence(root); try { persistence.migrate(); } finally { persistence.close(); }
  process.stdout.write(`Initialized ${work}\nNext: configure .bizdoc/project.yaml, then run 'bizdoc doctor' and 'bizdoc analyze'.\n`);
}

function withPersistence<T>(root: string, operation: (persistence: Persistence) => T): T {
  const persistence = new Persistence(root);
  try { persistence.migrate(); return operation(persistence); } finally { persistence.close(); }
}

async function withPersistenceAsync<T>(root: string, operation: (persistence: Persistence) => Promise<T>): Promise<T> {
  const persistence = new Persistence(root);
  try { persistence.migrate(); return await operation(persistence); } finally { persistence.close(); }
}

function latestFeatures(root: string): BusinessFeature[] {
  return withPersistence(root, (persistence) => businessSnapshotSchema.parse(persistence.latestSnapshot()).features);
}

function listDocuments(root: string): DocumentRecord[] {
  return withPersistence(root, (persistence) => persistence.listDocuments());
}

function writeJson(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function writeRows(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const format = (row: string[]): string => row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join('  ');
  process.stdout.write(`${format(headers)}\n${format(widths.map((width) => '-'.repeat(width)))}\n`);
  rows.forEach((row) => process.stdout.write(`${format(row)}\n`));
}

function requiresBusinessModuleClassification(model: unknown): boolean {
  if (!model || typeof model !== 'object' || !('classification' in model)) return true;
  const classification = (model as { classification?: unknown }).classification;
  if (!classification || typeof classification !== 'object' || !('module' in classification)) return true;
  const module = (classification as { module?: unknown }).module;
  if (!module || typeof module !== 'object' || !('name' in module)) return true;
  const name = (module as { name?: unknown }).name;
  return typeof name !== 'string' || !name.trim() || name.trim() === '未分类';
}

async function selectFeature(root: string, explicit?: string): Promise<string> {
  const features = latestFeatures(root);
  if (explicit) {
    if (!features.some((feature) => feature.id === explicit)) throw new Error(`Feature not found in the latest snapshot: ${explicit}`);
    return explicit;
  }
  return chooseOne('选择业务功能', features.map((feature) => ({ value: feature.id, label: feature.name, detail: `${feature.confidence} · ${feature.apiRefs.map((api) => `${api.method} ${api.path}`).join(', ')}` })));
}

async function selectDocument(root: string, input: { documentId?: string; featureId?: string; statuses?: string[] } = {}): Promise<DocumentRecord> {
  if (input.documentId && input.featureId) throw new Error('Provide at most one of --document and --feature');
  const documents = listDocuments(root).filter((document) => !input.statuses || input.statuses.includes(document.status));
  const wanted = input.documentId ?? (input.featureId ? documentIdForFeature(input.featureId) : undefined);
  if (wanted) {
    const found = documents.find((document) => document.id === wanted); if (!found) throw new Error(`Document not found: ${wanted}`); return found;
  }
  const selected = await chooseOne('选择业务文档', documents.map((document) => ({ value: document.id, label: document.title, detail: `revision ${document.revision} · ${document.status}` })));
  return documents.find((document) => document.id === selected)!;
}

function assertClassifiableDocument(document: DocumentRecord): DocumentRecord {
  if (!requiresBusinessModuleClassification(document.model)) {
    const model = documentationModelSchema.parse(document.model);
    throw new Error(`DOCUMENT_ALREADY_CLASSIFIED: ${document.id} is already assigned to ${model.classification!.system.name}/${model.classification!.module.name}`);
  }
  if (document.status !== 'approved') throw new Error(`REVIEW_REQUIRED: ${document.id} revision ${document.revision} is ${document.status}`);
  return document;
}

async function selectClassifiableDocument(root: string, input: { documentId?: string; featureId?: string } = {}): Promise<DocumentRecord> {
  if (input.documentId && input.featureId) throw new Error('Provide at most one of --document and --feature');
  const documents = listDocuments(root); const wanted = input.documentId ?? (input.featureId ? documentIdForFeature(input.featureId) : undefined);
  if (wanted) {
    const found = documents.find((document) => document.id === wanted);
    if (!found) throw new Error(`Document not found: ${wanted}`);
    return assertClassifiableDocument(found);
  }
  const candidates = documents.filter((document) => document.status === 'approved' && requiresBusinessModuleClassification(document.model));
  if (candidates.length === 0) throw new Error('No approved unclassified documents are available');
  const selected = await chooseOne('选择需要归类的旧版业务文档', candidates.map((document) => ({ value: document.id, label: document.title, detail: `revision ${document.revision}` })));
  return candidates.find((document) => document.id === selected)!;
}

async function selectStep(document: DocumentRecord, explicit?: string): Promise<{ id: string; title: string }> {
  const model = documentationModelSchema.parse(document.model);
  if (explicit) {
    const found = model.steps.find((step) => step.id === explicit); if (!found) throw new Error(`Document section not found: ${explicit}`); return found;
  }
  const selected = await chooseOne('选择截图对应步骤', model.steps.map((step) => ({ value: step.id, label: step.title, detail: `${step.screenshots.length} 张截图` })));
  return model.steps.find((step) => step.id === selected)!;
}

async function selectScreenshotTarget(root: string, input: { documentId?: string; featureId?: string; sectionId?: string }): Promise<{ document: DocumentRecord; step: { id: string; title: string } }> {
  const document = await selectDocument(root, { ...(input.documentId ? { documentId: input.documentId } : {}), ...(input.featureId ? { featureId: input.featureId } : {}) });
  return { document, step: await selectStep(document, input.sectionId) };
}

async function attachScreenshot(app: AppContext, root: string, target: { document: DocumentRecord; step: { id: string; title: string } }, file: string, alt?: string): Promise<void> {
  const { document, step } = target;
  const result = await app.get(AttachScreenshotUseCase).execute(root, document.id, step.id, file, alt ?? `${step.title}页面截图`);
  writeJson({ documentId: document.id, title: document.title, sectionId: step.id, sectionTitle: step.title, ...result });
}

async function addScreenshot(app: AppContext, root: string, input: { file?: string; documentId?: string; featureId?: string; sectionId?: string; alt?: string }): Promise<void> {
  if (!input.file && !terminalPromptIO().interactive) throw new Error("Screenshot file selection requires an interactive terminal. Pass the file path to 'bizdoc screenshot add <file>'.");
  const target = await selectScreenshotTarget(root, input); const file = input.file ?? await chooseScreenshotFile();
  await attachScreenshot(app, root, target, file, input.alt);
}

function approveDocument(app: AppContext, root: string, documentId: string, revision: number): void {
  app.get(ReviewDocumentUseCase).execute(root, documentId, revision); process.stdout.write(`Approved ${documentId} revision ${revision}\n`);
}

async function publishFeishu(app: AppContext, root: string, documentId?: string): Promise<void> {
  const config = await loadProjectConfig(root); const target = config.publishing?.feishu;
  if (!target || target.space_id === 'pending-user-input') throw new Error('Feishu space_id is not configured in .bizdoc/project.yaml');
  const selected = await selectDocument(root, { ...(documentId ? { documentId } : {}), statuses: ['approved'] });
  if (requiresBusinessModuleClassification(selected.model)) throw new Error(`DOCUMENT_CLASSIFICATION_REQUIRED: run 'bizdoc documents classify' for ${selected.id} with a confirmed business module before publishing`);
  const model = documentationModelSchema.parse(selected.model);
  const classification = model.classification;
  if (!classification) throw new Error(`DOCUMENT_CLASSIFICATION_REQUIRED: run 'bizdoc documents classify' for ${selected.id} with a confirmed business module before publishing`);
  const imageCount = model.steps.reduce((count, step) => count + step.screenshots.length, 0);
  process.stdout.write(`Feishu path: ${classification.system.name}/${classification.module.name}/${model.title}\nRevision: ${selected.revision}\nImages: ${imageCount}\n`);
  if (imageCount > 0) process.stdout.write('Required image scope: docs:document.media:upload\n');
  if (terminalPromptIO().interactive && !await confirm('确认发布到以上飞书路径？')) throw new Error('Publish cancelled');
  const credentials = new CredentialStore(); const client = new FeishuSdkClient({ appId: credentials.require('FEISHU_APP_ID'), appSecret: credentials.require('FEISHU_APP_SECRET') });
  const targetId = `feishu:${target.space_id}`; const baseTarget = { id: targetId, spaceId: target.space_id, ...(target.parent_node_token ? { parentNodeToken: target.parent_node_token } : {}) };
  let moduleNodeToken: string | undefined;
  const publisher: Publisher = { publish: async (input) => {
    await preflightFeishuPublish(input);
    const resolved = await withPersistenceAsync(root, (persistence) => new FeishuHierarchyResolver(client, baseTarget, persistence).ensurePath(classification));
    moduleNodeToken = resolved.module.nodeToken;
    return new FeishuPublisher(client, { id: targetId, spaceId: target.space_id, parentNodeToken: moduleNodeToken, manageNodeLocation: true }).publish(input);
  } };
  const result = await app.get(PublishDocumentUseCase).execute(root, selected.id, targetId, publisher);
  const resolvedModuleNodeToken = moduleNodeToken as string | undefined;
  if (!resolvedModuleNodeToken) throw new Error('Feishu module node was not resolved');
  withPersistence(root, (persistence) => persistence.savePublicationNodeMapping({ targetId, localNodeId: selected.id, nodeKind: 'document', logicalParentId: classification.module.id, title: model.title, nodeToken: result.nodeToken, documentToken: result.documentToken, parentNodeToken: resolvedModuleNodeToken }));
  writeJson(result);
}

async function main(): Promise<void> {
  let appPromise: Promise<AppContext> | undefined;
  const getApp = (): Promise<AppContext> => { appPromise ??= NestFactory.createApplicationContext(AppModule, { logger: false }); return appPromise; };
  const credentials = new CredentialStore();
  const program = new Command().name('bizdoc').description('Generate evidence-backed business operation documentation').version(CLI_VERSION).showHelpAfterError();

  program.command('init').argument('[directory]', 'project directory').option('--system-name <name>', 'business system display name').action(async (directory: string | undefined, options: { systemName?: string }) => initProject(directory, options.systemName));

  const auth = program.command('auth').description('manage persistent credentials');
  auth.command('set').addArgument(new Argument('<target>').choices(Object.keys(credentialNamesByTarget))).action(async (target: CredentialTarget) => {
    const values: Array<readonly [CredentialName, string]> = [];
    for (const name of credentialNamesByTarget[target]) values.push([name, await askText(name, { secret: name !== 'AI_BASE_URL', unavailableMessage: `Interactive credential input is unavailable. Provide ${name} as an environment variable in this non-interactive environment.` })]);
    credentials.setMany(values);
    process.stdout.write(`Stored ${target} credentials in macOS Keychain.\n`);
  });
  auth.command('status').action(() => writeRows(['TARGET', 'CREDENTIAL', 'SOURCE'], Object.entries(credentialNamesByTarget).flatMap(([target, names]) => names.map((name) => [target, name, credentials.source(name)]))));
  auth.command('remove').addArgument(new Argument('<target>').choices(Object.keys(credentialNamesByTarget))).action((target: CredentialTarget) => {
    const removed = credentialNamesByTarget[target].filter((name) => credentials.remove(name)); process.stdout.write(`Removed ${removed.length} ${target} credential(s) from macOS Keychain. Environment variables are unchanged.\n`);
  });

  program.command('analyze').argument('[directory]', 'configured project workspace').action(async (directory?: string) => {
    const root = await resolveWorkspaceRoot(directory); const result = await (await getApp()).get(AnalyzeProjectUseCase).execute(root); writeJson({ runId: result.snapshot.runId, output: result.output, ...result.metrics });
  });
  program.command('features').argument('[directory]', 'configured project workspace').option('--json', 'machine-readable output', false).action(async (directory: string | undefined, options: { json: boolean }) => {
    const root = await resolveWorkspaceRoot(directory); const features = latestFeatures(root);
    if (options.json) writeJson(features.map(({ id, name, confidence, module, apiRefs }) => ({ id, name, confidence, technicalOwner: module, apiRefs })));
    else writeRows(['ID', 'NAME', 'CONFIDENCE'], features.map((feature) => [feature.id, feature.name, feature.confidence]));
  });
  const documents = program.command('documents').argument('[directory]', 'configured project workspace').option('--json', 'machine-readable output', false).action(async (directory: string | undefined, options: { json: boolean }) => {
    const root = await resolveWorkspaceRoot(directory); const documents = listDocuments(root);
    if (options.json) writeJson(documents.map((document) => ({ id: document.id, featureId: document.featureId, title: document.title, revision: document.revision, status: document.status, markdownPath: document.markdownPath, updatedAt: document.updatedAt })));
    else writeRows(['ID', 'TITLE', 'REVISION', 'STATUS'], documents.map((document) => [document.id, document.title, String(document.revision), document.status]));
  });
  documents.command('classify').description('add system and business-module metadata to an approved legacy document')
    .option('--document <id>').option('--feature <id>').option('--module <name>').option('--module-id <id>').option('--directory <path>', 'configured workspace')
    .action(async (options: { document?: string; feature?: string; module?: string; moduleId?: string; directory?: string }) => {
      const root = await resolveWorkspaceRoot(options.directory); const selected = await selectClassifiableDocument(root, { ...(options.document ? { documentId: options.document } : {}), ...(options.feature ? { featureId: options.feature } : {}) });
      const config = await loadProjectConfig(root); const configuredDefault = config.publishing?.feishu?.default_module;
      let moduleName = options.module?.trim() || (configuredDefault?.trim() && configuredDefault.trim() !== '未分类' ? configuredDefault.trim() : undefined);
      if (!moduleName && terminalPromptIO().interactive) moduleName = await askText('业务模块');
      if (!moduleName) throw new Error("A confirmed business module is required. Pass '--module <name>' in non-interactive mode.");
      const systemName = config.project.display_name ?? config.project.name;
      if (terminalPromptIO().interactive && !await confirm(`为“${selected.title}”创建分类修订：${systemName}/${moduleName}？`)) throw new Error('Classification cancelled');
      const result = await (await getApp()).get(ClassifyDocumentUseCase).execute(root, selected.id, moduleName, options.moduleId);
      writeJson({ documentId: result.document.id, title: result.document.title, classification: result.document.classification, revision: result.document.revision, status: result.status, path: result.markdownPath, next: 'Preview and run bizdoc review approve before publishing.' });
    });
  program.command('generate').argument('[directory]', 'configured project workspace').option('--feature <id>', 'generate one feature').option('--all', 'generate every feature', false).option('--ai', 'use AI (legacy explicit flag)', false).option('--template', 'use the evidence template instead of configured AI', false).option('--module <name>', 'confirmed business module name').option('--module-id <id>', 'stable business module id').action(async (directory: string | undefined, options: { feature?: string; all: boolean; ai: boolean; template: boolean; module?: string; moduleId?: string }) => {
    if (options.feature && options.all) throw new Error('Use either --feature or --all, not both'); if (options.ai && options.template) throw new Error('Use either --ai or --template, not both');
    const root = await resolveWorkspaceRoot(directory); const config = await loadProjectConfig(root); let featureId = options.feature;
    if (!featureId && !options.all) featureId = await selectFeature(root);
    const defaultModule = config.publishing?.feishu?.default_module ?? '未分类';
    const moduleName = options.module ?? (options.all || !terminalPromptIO().interactive ? defaultModule : await askText('业务模块', { defaultValue: defaultModule }));
    const useAi = options.ai || (!options.template && Boolean(config.ai));
    const result = await (await getApp()).get(GenerateDocumentUseCase).execute(root, featureId, useAi, { credentialLookup: (name) => credentials.get(name as CredentialName), moduleName, ...(options.moduleId ? { moduleId: options.moduleId } : {}) });
    writeJson({ count: result.documents.length, documents: result.documents.map((document, index) => ({ id: document.id, title: document.title, classification: document.classification, revision: document.revision, path: result.paths[index], steps: document.steps.map((step) => ({ id: step.id, title: step.title })) })) });
  });

  program.command('screenshot-add').argument('<document-id>').argument('<section-id>').argument('<file>').option('--alt <text>', 'image alt text', '页面截图').option('--directory <path>', 'configured workspace').action(async (documentId: string, sectionId: string, file: string, options: { alt: string; directory?: string }) => addScreenshot(await getApp(), await resolveWorkspaceRoot(options.directory), { documentId, sectionId, file, alt: options.alt }));
  const screenshot = program.command('screenshot').description('manage screenshots');
  screenshot.command('add').argument('[file]').option('--document <id>').option('--feature <id>').option('--section <id>').option('--alt <text>', 'image alt text').option('--directory <path>', 'configured workspace').action(async (file: string | undefined, options: { document?: string; feature?: string; section?: string; alt?: string; directory?: string }) => addScreenshot(await getApp(), await resolveWorkspaceRoot(options.directory), { ...(file ? { file } : {}), ...(options.document ? { documentId: options.document } : {}), ...(options.feature ? { featureId: options.feature } : {}), ...(options.section ? { sectionId: options.section } : {}), ...(options.alt ? { alt: options.alt } : {}) }));
  screenshot.command('capture').option('--document <id>').option('--feature <id>').option('--section <id>').option('--alt <text>', 'image alt text').option('--directory <path>', 'configured workspace').option('--ack-redaction', 'confirm the captured page is already redacted', false).action(async (options: { document?: string; feature?: string; section?: string; alt?: string; directory?: string; ackRedaction: boolean }) => {
    const root = await resolveWorkspaceRoot(options.directory);
    const target = await selectScreenshotTarget(root, { ...(options.document ? { documentId: options.document } : {}), ...(options.feature ? { featureId: options.feature } : {}), ...(options.section ? { sectionId: options.section } : {}) });
    if (!options.ackRedaction && !await confirm('截图不会自动脱敏，确认当前页面已完成脱敏？')) throw new Error('Capture cancelled: redaction was not confirmed');
    const captured = await captureScreenshot();
    try { await attachScreenshot(await getApp(), root, target, captured.file, options.alt); } finally { await captured.cleanup(); }
  });

  program.command('review-approve').argument('<document-id>').argument('<revision>').option('--directory <path>', 'configured workspace').action(async (documentId: string, revision: string, options: { directory?: string }) => approveDocument(await getApp(), await resolveWorkspaceRoot(options.directory), documentId, Number(revision)));
  const review = program.command('review').description('review document revisions');
  review.command('approve').option('--document <id>').option('--revision <number>').option('--directory <path>', 'configured workspace').action(async (options: { document?: string; revision?: string; directory?: string }) => {
    const root = await resolveWorkspaceRoot(options.directory); const document = await selectDocument(root, options.document ? { documentId: options.document } : {}); const revision = options.revision ? Number(options.revision) : document.revision;
    if (terminalPromptIO().interactive && !await confirm(`确认已人工检查“${document.title}”修订 ${revision}？`)) throw new Error('Approval cancelled'); approveDocument(await getApp(), root, document.id, revision);
  });

  program.command('preview').argument('[markdown-file]').option('--directory <path>', 'configured workspace').option('--port <number>', 'local port', '4173').action(async (markdownFile: string | undefined, options: { directory?: string; port: string }) => {
    let selected = markdownFile ? path.resolve(markdownFile) : undefined;
    if (!selected) { const root = await resolveWorkspaceRoot(options.directory); const latest = withPersistence(root, (persistence) => persistence.latestDocument()); if (!latest.markdownPath) throw new Error(`Latest document ${latest.id} has no Markdown output`); selected = latest.markdownPath; }
    const preview = await startLocalPreview(selected, Number(options.port)); process.stdout.write(`Preview: ${preview.url}\nPress Ctrl+C to stop.\n`);
  });

  program.command('publish-feishu').argument('<document-id>').option('--directory <path>', 'configured workspace').action(async (documentId: string, options: { directory?: string }) => publishFeishu(await getApp(), await resolveWorkspaceRoot(options.directory), documentId));
  const publish = program.command('publish').description('publish approved documents');
  publish.command('feishu').option('--document <id>').option('--directory <path>', 'configured workspace').action(async (options: { document?: string; directory?: string }) => publishFeishu(await getApp(), await resolveWorkspaceRoot(options.directory), options.document));

  program.command('status').argument('[directory]', 'configured project workspace').action(async (directory?: string) => {
    const root = await resolveWorkspaceRoot(directory); const config = await loadProjectConfig(root); const documents = listDocuments(root); let featureCount = 0; try { featureCount = latestFeatures(root).length; } catch { /* Analysis has not run yet. */ }
    const sources = (names: CredentialName[]): string => names.map((name) => `${name}: ${credentials.source(name)}`).join(', ');
    writeRows(['ITEM', 'VALUE'], [['Workspace', root], ['System', config.project.display_name ?? config.project.name], ['Features', String(featureCount)], ['Documents', String(documents.length)], ['Latest document', documents[0] ? `${documents[0].title} · r${documents[0].revision} · ${documents[0].status}` : 'none'], ['AI credentials', config.ai ? sources(requiredAiCredentialNames(config.ai)) : 'not configured'], ['Feishu credentials', config.publishing?.feishu ? sources(credentialNamesByTarget.feishu) : 'not configured']]);
  });
  program.command('doctor').argument('[directory]', 'configured project workspace').action(async (directory?: string) => {
    const root = await resolveWorkspaceRoot(directory); const config = await loadProjectConfig(root); const checks: string[][] = []; let failed = false;
    for (const [name, source] of Object.entries(config.sources)) {
      const sourcePath = path.resolve(root, source.path); let result: string;
      try { result = (await stat(sourcePath)).isDirectory() ? 'ok' : `not a directory: ${sourcePath}`; } catch { result = `missing: ${sourcePath}`; }
      checks.push([`${name} source`, result]); if (result !== 'ok') failed = true;
    }
    if (config.ai) {
      for (const name of requiredAiCredentialNames(config.ai)) { const source = credentials.source(name); checks.push([name, source]); if (source === 'missing') failed = true; }
    }
    const feishuTarget = config.publishing?.feishu; const feishuConfigured = Boolean(feishuTarget && feishuTarget.space_id !== 'pending-user-input');
    checks.push(['Feishu config', !feishuTarget ? 'not configured' : feishuConfigured ? 'ok' : 'invalid placeholder space_id']);
    if (feishuTarget && !feishuConfigured) failed = true;
    if (feishuConfigured) {
      for (const name of credentialNamesByTarget.feishu) { const source = credentials.source(name); checks.push([name, source]); if (source === 'missing') failed = true; }
    }
    writeRows(['CHECK', 'RESULT'], checks); if (failed) throw new Error('Doctor found missing required configuration');
  });

  try { await program.parseAsync(process.argv); } finally { if (appPromise) await (await appPromise).close(); }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (process.env.BIZDOC_VERBOSE === '1' ? error.stack ?? error.message : error.message) : String(error); process.stderr.write(`${detail}\n`); process.exitCode = 1;
});
