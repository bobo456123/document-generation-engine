import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Persistence } from '@bizdoc/persistence';
import { PublishError, type Publisher } from '@bizdoc/publisher';
import { AnalyzeProjectUseCase, GenerateDocumentUseCase, PublishDocumentUseCase, ReviewDocumentUseCase, selectComposerFacts } from './index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('selectComposerFacts', () => {
  it('includes nearby frontend context and prioritizes direct frontend facts', () => {
    const evidence = (id: string, file: string) => ({ id, source: 'SOURCE_CODE' as const, repository: '/absolute/crm', file, excerpt: id });
    const facts = [
      { id: 'fact:backend', kind: 'HTTP_ENDPOINT' as const, name: 'save', confidence: 'verified' as const, evidence: evidence('evidence:b', 'Controller.java') },
      { id: 'fact:condition', kind: 'CONDITION' as const, name: 'status', confidence: 'verified' as const, evidence: evidence('evidence:c', 'Drawer.tsx') },
      { id: 'fact:frontend', kind: 'SERVICE_CALL' as const, name: 'saveLead', confidence: 'verified' as const, evidence: evidence('evidence:f', 'Drawer.tsx') }
    ];
    const selected = selectComposerFacts({
      id: 'feature:1', name: 'convert', module: 'Lead', roles: [], frontendRefs: ['fact:frontend'], backendRefs: ['fact:backend'],
      apiRefs: [], entities: [], fields: [], rules: [], outcomes: [], confidence: 'verified', evidenceIds: ['evidence:f', 'evidence:b']
    }, facts);
    expect(selected.map((fact) => fact.id)).toEqual(['fact:frontend', 'fact:condition', 'fact:backend']);
  });
});

describe('PublishDocumentUseCase', () => {
  it('rejects a revision that has not been approved without calling the publisher', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-publish-'));
    roots.push(root);
    await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root);
    persistence.migrate();
    const document = {
      id: 'document:1', featureId: 'feature:1', title: '待审核文档', roles: [], scenarios: [], steps: [], fields: [],
      outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1
    };
    persistence.saveDocument(document, 'needs_review', path.join(root, 'document.md'));
    persistence.close();
    const publish = vi.fn<Publisher['publish']>();

    await expect(new PublishDocumentUseCase().execute(root, 'document:1', 'target:1', { publish }))
      .rejects.toThrow('REVIEW_REQUIRED: document:1 revision 1 is needs_review');
    expect(publish).not.toHaveBeenCalled();

    const verification = new Persistence(root);
    expect(verification.db.prepare('SELECT COUNT(*) AS count FROM publications').get()).toEqual({ count: 0 });
    verification.close();
  });

  it('requires the latest revision to be approved and records categorized publisher failures', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-publish-'));
    roots.push(root);
    await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    const base = { id: 'document:2', featureId: 'feature:2', title: '文档', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [] };
    persistence.saveDocument({ ...base, revision: 1 }, 'needs_review', path.join(root, 'revision-1.md'));
    persistence.approveDocument(base.id, 1);
    persistence.saveDocument({ ...base, revision: 2 }, 'needs_review', path.join(root, 'revision-2.md'));
    persistence.close();
    const useCase = new PublishDocumentUseCase();
    await expect(useCase.execute(root, base.id, 'target:1', { publish: vi.fn() })).rejects.toThrow('revision 2 is needs_review');

    const approval = new Persistence(root); approval.approveDocument(base.id, 2); approval.close();
    const failure = new PublishError('forbidden', 'AUTHORIZATION', false, 403);
    failure.nodeToken = 'node-partial'; failure.documentToken = 'doc-partial';
    await expect(useCase.execute(root, base.id, 'target:1', { publish: vi.fn().mockRejectedValue(failure) })).rejects.toBe(failure);
    const verification = new Persistence(root);
    const row = verification.db.prepare('SELECT status,error_category,remote_node_token,remote_document_token,started_at,finished_at FROM publications').get() as Record<string, string>;
    expect(row).toMatchObject({ status: 'failed', error_category: 'AUTHORIZATION', remote_node_token: 'node-partial', remote_document_token: 'doc-partial' });
    expect(row.started_at).toBeTruthy(); expect(row.finished_at).toBeTruthy();
    verification.close();

    const publish = vi.fn<Publisher['publish']>().mockResolvedValue({ nodeToken: 'node-partial', documentToken: 'doc-partial', created: false });
    await useCase.execute(root, base.id, 'target:1', { publish });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ existing: { nodeToken: 'node-partial', documentToken: 'doc-partial' } }));
  });

  it('rejects approved documents that still have blocking review items', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-publish-review-')); roots.push(root);
    await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    const document = {
      id: 'document:blocking', featureId: 'feature:blocking', title: '待复核文档', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [],
      reviewItems: [{ id: 'review:1', sectionId: 'document:blocking', message: '需要人工复核', severity: 'blocking' as const }], revision: 1
    };
    persistence.saveDocument(document, 'approved', path.join(root, 'document.md')); persistence.close();
    const publish = vi.fn<Publisher['publish']>();
    await expect(new PublishDocumentUseCase().execute(root, document.id, 'target:1', { publish })).rejects.toThrow('has blocking review items');
    expect(publish).not.toHaveBeenCalled();
  });

  it('records explicit review resolution without mutating the document revision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-review-resolution-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    const document = {
      id: 'document:resolved', featureId: 'feature:resolved', title: 'Reviewed', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [],
      reviewItems: [{ id: 'review:blocking', sectionId: 'document:resolved', message: 'Check this', severity: 'blocking' as const }], revision: 1
    };
    persistence.saveDocument(document, 'needs_review', '/tmp/reviewed.md'); const before = persistence.getDocument(document.id, 1).model;
    persistence.approveDocument(document.id, 1);
    expect(persistence.unresolvedBlockingReviewItems(document.id, 1)).toEqual([]);
    expect(persistence.getDocument(document.id, 1).model).toEqual(before);
    persistence.close();
    const publish = vi.fn<Publisher['publish']>().mockResolvedValue({ nodeToken: 'node', documentToken: 'doc', created: true });
    await expect(new PublishDocumentUseCase().execute(root, document.id, 'target:1', { publish })).resolves.toMatchObject({ created: true });
  });

  it('reuses one remote mapping across repeat publication and a new approved revision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-publish-idempotent-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    const base = { id: 'document:idempotent', featureId: 'feature:idempotent', title: 'Document', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [] };
    persistence.saveDocument({ ...base, revision: 1 }, 'needs_review', '/tmp/revision-1.md'); persistence.approveDocument(base.id, 1); persistence.close();
    const publish = vi.fn<Publisher['publish']>(async (input) => ({
      nodeToken: input.existing?.nodeToken ?? 'node:stable', documentToken: input.existing?.documentToken ?? 'doc:stable', created: !input.existing
    }));
    const useCase = new PublishDocumentUseCase();
    await useCase.execute(root, base.id, 'target:idempotent', { publish });
    await useCase.execute(root, base.id, 'target:idempotent', { publish });
    const next = new Persistence(root); next.saveDocument({ ...base, title: 'Updated', revision: 2 }, 'needs_review', '/tmp/revision-2.md'); next.approveDocument(base.id, 2); next.close();
    await useCase.execute(root, base.id, 'target:idempotent', { publish });
    expect(publish).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ existing: expect.anything() }));
    expect(publish).toHaveBeenNthCalledWith(2, expect.objectContaining({ existing: { nodeToken: 'node:stable', documentToken: 'doc:stable' } }));
    expect(publish).toHaveBeenNthCalledWith(3, expect.objectContaining({ document: expect.objectContaining({ revision: 2, title: 'Updated' }), existing: { nodeToken: 'node:stable', documentToken: 'doc:stable' } }));
    const verification = new Persistence(root);
    expect(verification.db.prepare("SELECT status,COUNT(*) AS count FROM publications GROUP BY status").all()).toEqual([{ status: 'completed', count: 3 }]);
    expect(verification.db.prepare('SELECT COUNT(DISTINCT remote_node_token) AS nodes,COUNT(DISTINCT remote_document_token) AS documents FROM publications').get()).toEqual({ nodes: 1, documents: 1 });
    verification.close();
  });
});

describe('AnalyzeProjectUseCase', () => {
  it('does not persist a successful run when one source has no analyzable files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-analyze-')); roots.push(root);
    await Promise.all([mkdir(path.join(root, '.bizdoc')), mkdir(path.join(root, 'frontend')), mkdir(path.join(root, 'backend'))]);
    await writeFile(path.join(root, '.bizdoc', 'project.yaml'), `version: 1\nproject:\n  name: empty\nsources:\n  frontend:\n    path: ./frontend\n    framework: react\n  backend:\n    path: ./backend\n    framework: spring-boot\nanalysis:\n  include: [src/**]\n  exclude: []\n`);
    await expect(new AnalyzeProjectUseCase().execute(root)).rejects.toThrow('No analyzable source files found');
    await expect(access(path.join(root, '.bizdoc', 'bizdoc.db'))).rejects.toThrow();
  });

  it('creates independent runs and snapshots on repeated analysis', async () => {
    const root = path.resolve('examples/crm-demo');
    const work = path.join(root, '.bizdoc');
    await mkdir(work, { recursive: true });
    try {
      await writeFile(path.join(work, 'project.yaml'), `version: 1\nproject:\n  name: fixture\nsources:\n  frontend:\n    path: ./frontend\n    framework: react\n  backend:\n    path: ./backend\n    framework: spring-boot\nanalysis:\n  include: [src/**]\n  exclude: []\n`);
      const useCase = new AnalyzeProjectUseCase();
      const first = await useCase.execute(root); const second = await useCase.execute(root);
      expect(second.snapshot.runId).not.toBe(first.snapshot.runId);
      expect(second.snapshot.id).not.toBe(first.snapshot.id);
      expect(second.snapshot.diagnostics?.parseFailures).toEqual([]);
      const firstDocument = (await new GenerateDocumentUseCase().execute(root)).documents[0];
      if (!firstDocument) throw new Error('Fixture document was not generated');
      new ReviewDocumentUseCase().execute(root, firstDocument.id, firstDocument.revision);
      const secondDocument = (await new GenerateDocumentUseCase().execute(root, firstDocument.featureId)).documents[0];
      expect(secondDocument?.revision).toBe(firstDocument.revision + 1);
      const persistence = new Persistence(root); persistence.migrate();
      expect(persistence.db.prepare('SELECT COUNT(*) AS count FROM analysis_runs').get()).toEqual({ count: 2 });
      expect(persistence.db.prepare('SELECT COUNT(*) AS count FROM business_snapshots').get()).toEqual({ count: 2 });
      expect(persistence.getDocument(firstDocument.id, firstDocument.revision).status).toBe('approved');
      expect(persistence.getDocument(firstDocument.id).status).toBe('needs_review');
      persistence.close();
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('keeps source credentials out of facts, reports and SQLite', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-redaction-')); roots.push(root);
    const frontend = path.join(root, 'frontend', 'src'); const backend = path.join(root, 'backend', 'src');
    await Promise.all([mkdir(path.join(root, '.bizdoc')), mkdir(frontend, { recursive: true }), mkdir(backend, { recursive: true })]);
    const frontendSecret = 'fixture-frontend-secret-123456';
    const backendSecret = 'fixture-backend-secret-654321';
    await writeFile(path.join(frontend, 'Config.ts'), `export const APP_SECRET = '${frontendSecret}';\nfetch('/api/ping');\n`);
    await writeFile(path.join(backend, 'PingController.java'), `@RequestMapping("/api")\nclass PingController {\n  String appSecret = "${backendSecret}";\n  @GetMapping("/ping") public String ping() { return "ok"; }\n}\n`);
    await writeFile(path.join(root, '.bizdoc', 'project.yaml'), `version: 1\nproject:\n  name: redaction-fixture\nsources:\n  frontend:\n    path: ./frontend\n    framework: react\n  backend:\n    path: ./backend\n    framework: spring-boot\nanalysis:\n  include: [src/**]\n  exclude: []\n`);

    const result = await new AnalyzeProjectUseCase().execute(root);
    const report = await readFile(result.output, 'utf8');
    const persistence = new Persistence(root); const persisted = JSON.stringify(persistence.latestSnapshot()); persistence.close();
    const database = await readFile(path.join(root, '.bizdoc', 'bizdoc.db'));
    for (const secret of [frontendSecret, backendSecret]) {
      expect(JSON.stringify(result.snapshot)).not.toContain(secret);
      expect(report).not.toContain(secret);
      expect(persisted).not.toContain(secret);
      expect(database.includes(Buffer.from(secret))).toBe(false);
    }
    expect(report).toContain('[REDACTED]');
  });
});
