#!/usr/bin/env node
import 'reflect-metadata';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Command } from 'commander';
import YAML from 'yaml';
import { AppModule } from '../../server/src/app.module.js';
import { defaultProjectConfig } from '@bizdoc/config';
import { Persistence } from '@bizdoc/persistence';
import { AnalyzeProjectUseCase, AttachScreenshotUseCase, GenerateDocumentUseCase, PublishDocumentUseCase, ReviewDocumentUseCase } from '@bizdoc/application';
import { startLocalPreview } from '@bizdoc/markdown-renderer';
import { loadProjectConfig } from '@bizdoc/config';
import { FeishuPublisher, FeishuSdkClient } from '@bizdoc/publisher-feishu';

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

async function initProject(directory: string): Promise<void> {
  const root = path.resolve(directory);
  const work = path.join(root, '.bizdoc');
  const configFile = path.join(work, 'project.yaml');
  if (await exists(configFile)) throw new Error(`Configuration already exists: ${configFile}`);
  await mkdir(path.join(work, 'assets'), { recursive: true });
  await mkdir(path.join(work, 'output'), { recursive: true });
  await mkdir(path.join(work, 'logs'), { recursive: true });
  await writeFile(configFile, YAML.stringify(defaultProjectConfig(path.basename(root))), { flag: 'wx' });
  const persistence = new Persistence(root);
  persistence.migrate();
  persistence.close();
  process.stdout.write(`Initialized ${work}\n`);
}

async function addScreenshot(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>, directory: string, documentId: string, sectionId: string, file: string, alt: string): Promise<void> {
  const result = await app.get(AttachScreenshotUseCase).execute(directory, documentId, sectionId, file, alt);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function approveDocument(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>, directory: string, documentId: string, revision: number): void {
  app.get(ReviewDocumentUseCase).execute(directory, documentId, revision);
  process.stdout.write(`Approved ${documentId} revision ${revision}\n`);
}

async function publishFeishu(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>, directory: string, documentId: string): Promise<void> {
  const root = path.resolve(directory); const config = await loadProjectConfig(root); const target = config.publishing?.feishu;
  if (!target || target.space_id === 'pending-user-input') throw new Error('Feishu space_id is not configured in .bizdoc/project.yaml');
  const appId = process.env.FEISHU_APP_ID; const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET environment variables are required');
  const persistence = new Persistence(root); persistence.migrate(); const current = persistence.getDocument(documentId); const model = current.model as { title?: string; steps?: Array<{ screenshots?: unknown[] }> }; persistence.close();
  const imageCount = model.steps?.reduce((count, step) => count + (step.screenshots?.length ?? 0), 0) ?? 0;
  process.stdout.write(`Target space: ${target.space_id}\nParent node: ${target.parent_node_token ?? '(root)'}\nDocument: ${model.title ?? documentId}\nRevision: ${current.revision}\nImages: ${imageCount}\n`);
  const publisher = new FeishuPublisher(new FeishuSdkClient({ appId, appSecret }), { id: `feishu:${target.space_id}`, spaceId: target.space_id, ...(target.parent_node_token ? { parentNodeToken: target.parent_node_token } : {}) });
  const result = await app.get(PublishDocumentUseCase).execute(root, documentId, `feishu:${target.space_id}`, publisher);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const program = new Command()
    .name('bizdoc')
    .description('Generate evidence-backed business operation documentation')
    .version('0.1.0');
  program.command('init').argument('[directory]', 'project directory', '.').action(initProject);
  program.command('analyze').argument('[directory]', 'configured project workspace', '.').action(async (directory: string) => {
    const result = await app.get(AnalyzeProjectUseCase).execute(directory);
    process.stdout.write(`${JSON.stringify({ runId: result.snapshot.runId, output: result.output, ...result.metrics }, null, 2)}\n`);
  });
  program.command('generate').argument('[directory]', 'configured project workspace', '.').option('--feature <id>', 'generate one feature').option('--ai', 'use the configured AI provider', false).action(async (directory: string, options: { feature?: string; ai: boolean }) => {
    const result = await app.get(GenerateDocumentUseCase).execute(directory, options.feature, options.ai);
    process.stdout.write(`${JSON.stringify({ count: result.documents.length, documents: result.documents.map((document, index) => ({ id: document.id, revision: document.revision, path: result.paths[index] })) }, null, 2)}\n`);
  });
  program.command('screenshot-add').argument('<document-id>').argument('<section-id>').argument('<file>').option('--alt <text>', 'image alt text', '页面截图').option('--directory <path>', 'configured workspace', '.').action(async (documentId: string, sectionId: string, file: string, options: { alt: string; directory: string }) => {
    await addScreenshot(app, options.directory, documentId, sectionId, file, options.alt);
  });
  program.command('review-approve').argument('<document-id>').argument('<revision>').option('--directory <path>', 'configured workspace', '.').action((documentId: string, revision: string, options: { directory: string }) => {
    approveDocument(app, options.directory, documentId, Number(revision));
  });
  program.command('screenshot').description('manage screenshots').command('add').argument('<file>').requiredOption('--document <id>').requiredOption('--section <id>').option('--alt <text>', 'image alt text', '页面截图').option('--directory <path>', 'configured workspace', '.').action(async (file: string, options: { document: string; section: string; alt: string; directory: string }) => {
    await addScreenshot(app, options.directory, options.document, options.section, file, options.alt);
  });
  program.command('review').description('review document revisions').command('approve').requiredOption('--document <id>').requiredOption('--revision <number>').option('--directory <path>', 'configured workspace', '.').action((options: { document: string; revision: string; directory: string }) => {
    approveDocument(app, options.directory, options.document, Number(options.revision));
  });
  program.command('preview').argument('<markdown-file>').option('--port <number>', 'local port', '4173').action(async (markdownFile: string, options: { port: string }) => {
    const preview = await startLocalPreview(path.resolve(markdownFile), Number(options.port)); process.stdout.write(`Preview: ${preview.url}\nPress Ctrl+C to stop.\n`);
  });
  program.command('publish-feishu').argument('<document-id>').option('--directory <path>', 'configured workspace', '.').action(async (documentId: string, options: { directory: string }) => {
    await publishFeishu(app, options.directory, documentId);
  });
  program.command('publish').description('publish approved documents').command('feishu').requiredOption('--document <id>').option('--directory <path>', 'configured workspace', '.').action(async (options: { document: string; directory: string }) => {
    await publishFeishu(app, options.directory, options.document);
  });
  try { await program.parseAsync(process.argv); } finally { await app.close(); }
}

main().catch((error: unknown) => {
  const detail = error instanceof Error
    ? (process.env.BIZDOC_VERBOSE === '1' ? error.stack ?? error.message : error.message)
    : String(error);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
});
