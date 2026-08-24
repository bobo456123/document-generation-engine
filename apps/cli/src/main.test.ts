import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { projectConfigSchema } from '@bizdoc/config';
import { Persistence } from '@bizdoc/persistence';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function localOnlyEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'AI_API_KEY', 'AI_BASE_URL', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET']) delete environment[name];
  return environment;
}

function documentFixture(id: string, title: string, classification?: { system: { id: string; name: string }; module: { id: string; name: string } }) {
  return {
    id, featureId: `feature:${id}`, title, ...(classification ? { classification } : {}), roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1
  };
}

describe('bizdoc init', () => {
  it('creates a valid project without overwriting it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-init-'));
    roots.push(root);
    const launcher = path.resolve('bin/bizdoc.mjs');
    await execFileAsync(process.execPath, [launcher, 'init', root], { cwd: process.cwd() });
    const configFile = path.join(root, '.bizdoc', 'project.yaml');
    const initial = await readFile(configFile, 'utf8');
    expect(projectConfigSchema.parse(YAML.parse(initial)).project.name).toBe(path.basename(root));
    await expect(execFileAsync(process.execPath, [launcher, 'init', root], { cwd: process.cwd() })).rejects.toMatchObject({ code: 1 });
    expect(await readFile(configFile, 'utf8')).toBe(initial);
  });

  it('initializes the current directory and discovers it from a nested directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-current-')); roots.push(root);
    const launcher = path.resolve('bin/bizdoc.mjs');
    await execFileAsync(process.execPath, [launcher, 'init', '--system-name', '销售 CRM'], { cwd: root });
    const nested = path.join(root, '.bizdoc', 'output');
    const { stdout } = await execFileAsync(process.execPath, [launcher, 'status'], { cwd: nested });
    expect(stdout).toContain('销售 CRM');
    expect(stdout).toContain(root);
  });

  it('runs the linked-source launcher outside the repository without leaking credential values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-launcher-')); roots.push(root);
    const launcher = path.resolve('bin/bizdoc.mjs');
    await expect(execFileAsync(process.execPath, [launcher, '--version'], { cwd: root })).resolves.toMatchObject({ stdout: '0.1.1\n' });
    const { stdout } = await execFileAsync(process.execPath, [launcher, 'auth', 'status'], { cwd: root, env: { ...process.env, ANTHROPIC_API_KEY: 'fixture-never-print-this-secret' } });
    expect(stdout).toContain('environment');
    expect(stdout).not.toContain('fixture-never-print-this-secret');
    await expect(execFileAsync(process.execPath, [launcher, 'auth', 'set', 'anthropic'], { cwd: root })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('Provide ANTHROPIC_API_KEY as an environment variable')
    });
  });

  it('does not require external credentials when AI and Feishu are not enabled', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-doctor-')); roots.push(root);
    const launcher = path.resolve('bin/bizdoc.mjs');
    await execFileAsync(process.execPath, [launcher, 'init'], { cwd: root });
    await Promise.all([mkdir(path.join(root, 'frontend')), mkdir(path.join(root, 'backend'))]);
    await expect(execFileAsync(process.execPath, [launcher, 'doctor'], { cwd: root })).resolves.toMatchObject({ stdout: expect.stringContaining('not configured') });
    await rm(path.join(root, 'frontend'), { recursive: true }); await writeFile(path.join(root, 'frontend'), 'not a directory');
    await expect(execFileAsync(process.execPath, [launcher, 'doctor'], { cwd: root })).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('not a directory') });
    await rm(path.join(root, 'frontend')); await mkdir(path.join(root, 'frontend'));
    const configFile = path.join(root, '.bizdoc', 'project.yaml'); const config = YAML.parse(await readFile(configFile, 'utf8')) as Record<string, unknown>;
    config.publishing = { feishu: { space_id: 'pending-user-input' } }; await writeFile(configFile, YAML.stringify(config));
    await expect(execFileAsync(process.execPath, [launcher, 'doctor'], { cwd: root })).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('invalid placeholder') });
  });

  it('keeps explicit workspace and legacy screenshot, review, and publish commands compatible', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-legacy-cli-')); roots.push(root);
    const launcher = path.resolve('bin/bizdoc.mjs');
    await execFileAsync(process.execPath, [launcher, 'init'], { cwd: root });
    const configFile = path.join(root, '.bizdoc', 'project.yaml');
    const config = YAML.parse(await readFile(configFile, 'utf8')) as Record<string, unknown>;
    config.publishing = { feishu: { space_id: 'test-space' } };
    await writeFile(configFile, YAML.stringify(config));
    const document = {
      id: 'document:legacy', featureId: 'feature:legacy', title: 'Legacy', roles: [], scenarios: [],
      steps: [{ id: 'step:legacy', title: 'Legacy step', instruction: { text: 'Do it', evidenceIds: [], confidence: 'inferred' as const }, screenshots: [] }],
      fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1
    };
    const persistence = new Persistence(root); persistence.migrate(); persistence.saveDocument(document, 'needs_review', path.join(root, 'revision-1.md')); persistence.close();
    const png = path.join(root, 'screenshot.png');
    await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    await expect(execFileAsync(process.execPath, [launcher, 'status', root], { cwd: tmpdir() })).resolves.toMatchObject({ stdout: expect.stringContaining(root) });
    await expect(execFileAsync(process.execPath, [launcher, 'screenshot-add', document.id, 'step:legacy', png, '--directory', root], { cwd: tmpdir() })).resolves.toMatchObject({ stdout: expect.stringContaining('"revision": 2') });
    await execFileAsync(process.execPath, [launcher, 'review-approve', document.id, '2', '--directory', root], { cwd: tmpdir() });
    const verification = new Persistence(root); expect(verification.getDocument(document.id).status).toBe('approved'); verification.close();
    await expect(execFileAsync(process.execPath, [launcher, 'publish-feishu', document.id, '--directory', root], { cwd: tmpdir() })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('DOCUMENT_CLASSIFICATION_REQUIRED') });
    const { stdout } = await execFileAsync(process.execPath, [launcher, 'documents', 'classify', '--document', document.id, '--module', '迁移模块', '--directory', root], { cwd: tmpdir() });
    expect(stdout).toContain('"status": "needs_review"'); expect(stdout).toContain('"name": "迁移模块"');
    const classified = new Persistence(root);
    expect(classified.getDocument(document.id, 2).status).toBe('approved');
    expect(classified.getDocument(document.id, 3)).toMatchObject({ status: 'needs_review', model: expect.objectContaining({ classification: expect.objectContaining({ module: expect.objectContaining({ name: '迁移模块' }) }) }) });
    classified.close();
  }, 15_000);

  it('classifies the only approved placeholder candidate without AI or Feishu credentials', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-classify-local-')); roots.push(root);
    const launcher = path.resolve('bin/bizdoc.mjs'); await execFileAsync(process.execPath, [launcher, 'init', '--system-name', '销售 CRM'], { cwd: root });
    const persistence = new Persistence(root); persistence.migrate();
    persistence.saveDocument(documentFixture('document:classified', '已归类', { system: { id: 'system:crm', name: '销售 CRM' }, module: { id: 'module:customer', name: '客户管理' } }), 'approved', '/tmp/classified.md');
    persistence.saveDocument(documentFixture('document:legacy-only', '待归类', { system: { id: 'system:crm', name: '销售 CRM' }, module: { id: 'module:placeholder', name: '未分类' } }), 'approved', '/tmp/legacy.md'); persistence.close();

    const { stdout } = await execFileAsync(process.execPath, [launcher, 'documents', 'classify', '--module', '线索管理'], { cwd: root, env: localOnlyEnvironment() });
    expect(stdout).toContain('"documentId": "document:legacy-only"'); expect(stdout).toContain('"name": "线索管理"');
    const verification = new Persistence(root);
    expect(verification.getDocument('document:classified')).toMatchObject({ revision: 1, status: 'approved' });
    expect(verification.getDocument('document:legacy-only')).toMatchObject({ revision: 2, status: 'needs_review' }); verification.close();
  });

  it.each(['', '   ', '未分类'] as const)('rejects the placeholder module name %j before reading Feishu credentials or publishing', async (moduleName) => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-publish-placeholder-')); roots.push(root);
    const launcher = path.resolve('bin/bizdoc.mjs'); await execFileAsync(process.execPath, [launcher, 'init'], { cwd: root });
    const configFile = path.join(root, '.bizdoc', 'project.yaml'); const config = YAML.parse(await readFile(configFile, 'utf8')) as Record<string, unknown>;
    config.publishing = { feishu: { space_id: 'test-space' } }; await writeFile(configFile, YAML.stringify(config));
    const document = documentFixture('document:placeholder', 'Placeholder', { system: { id: 'system:crm', name: 'CRM' }, module: { id: 'module:placeholder', name: moduleName } });
    const persistence = new Persistence(root); persistence.migrate(); persistence.saveDocument(document, 'approved', '/tmp/placeholder.md'); persistence.close();

    let failure: { code?: number; stderr?: string } | undefined;
    try { await execFileAsync(process.execPath, [launcher, 'publish-feishu', document.id], { cwd: root, env: localOnlyEnvironment() }); }
    catch (error) { failure = error as { code?: number; stderr?: string }; }
    expect(failure).toMatchObject({ code: 1, stderr: expect.stringContaining('DOCUMENT_CLASSIFICATION_REQUIRED') });
    expect(failure?.stderr).not.toContain('FEISHU_APP_ID'); expect(failure?.stderr).not.toContain('FEISHU_APP_SECRET');
    const verification = new Persistence(root); expect(verification.db.prepare('SELECT COUNT(*) AS count FROM publications').get()).toEqual({ count: 0 }); verification.close();
  });

  it('requires explicit document and module choices in non-interactive mode and refuses repeat migration', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-classify-arguments-')); roots.push(root);
    const launcher = path.resolve('bin/bizdoc.mjs'); await execFileAsync(process.execPath, [launcher, 'init'], { cwd: root });
    const first = documentFixture('document:first', 'First'); const second = documentFixture('document:second', 'Second');
    const persistence = new Persistence(root); persistence.migrate(); persistence.saveDocument(first, 'approved', '/tmp/first.md'); persistence.saveDocument(second, 'approved', '/tmp/second.md'); persistence.close();

    await expect(execFileAsync(process.execPath, [launcher, 'documents', 'classify', '--module', '线索管理'], { cwd: root, env: localOnlyEnvironment() })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('multiple choices') });
    await expect(execFileAsync(process.execPath, [launcher, 'documents', 'classify', '--document', first.id], { cwd: root, env: localOnlyEnvironment() })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Pass '--module <name>'") });
    const configFile = path.join(root, '.bizdoc', 'project.yaml'); const config = YAML.parse(await readFile(configFile, 'utf8')) as Record<string, unknown>;
    config.publishing = { feishu: { space_id: 'test-space', default_module: '默认业务模块' } }; await writeFile(configFile, YAML.stringify(config));
    await expect(execFileAsync(process.execPath, [launcher, 'documents', 'classify', '--document', first.id], { cwd: root, env: localOnlyEnvironment() })).resolves.toMatchObject({ stdout: expect.stringContaining('默认业务模块') });
    await expect(execFileAsync(process.execPath, [launcher, 'documents', 'classify', '--document', first.id, '--module', '其他模块'], { cwd: root, env: localOnlyEnvironment() })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('DOCUMENT_ALREADY_CLASSIFIED') });
    const verification = new Persistence(root); expect(verification.db.prepare('SELECT COUNT(*) AS count FROM document_revisions WHERE document_id=?').get(first.id)).toEqual({ count: 2 }); verification.close();
  });
});
