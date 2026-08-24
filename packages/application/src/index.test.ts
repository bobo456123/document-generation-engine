import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Persistence } from '@bizdoc/persistence';
import { PublishError, type Publisher } from '@bizdoc/publisher';
import { AnalyzeProjectUseCase, AttachScreenshotUseCase, ClassifyDocumentUseCase, GenerateDocumentUseCase, PublishDocumentUseCase, ReviewDocumentUseCase, selectComposerFacts } from './index.js';

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

describe('AttachScreenshotUseCase', () => {
  it('keeps relative paths for all existing screenshots when adding another revision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-attach-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    const document = {
      id: 'document:screenshots', featureId: 'feature:screenshots', title: 'Screenshots', roles: [], scenarios: [],
      steps: [{ id: 'step:1', title: 'Step', instruction: { text: 'Do it', evidenceIds: [], confidence: 'inferred' as const }, screenshots: [] }],
      fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1
    };
    persistence.saveDocument(document, 'needs_review', path.join(root, 'revision-1.md')); persistence.close();
    const png = path.join(root, 'first.png'); const webp = path.join(root, 'second.webp');
    await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    await writeFile(webp, Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64'));
    const useCase = new AttachScreenshotUseCase();
    const first = await useCase.execute(root, document.id, 'step:1', png, 'First');
    const second = await useCase.execute(root, document.id, 'step:1', webp, 'Second');
    expect(first.revision).toBe(2);
    expect(second.revision).toBe(3);
    const markdown = await readFile(second.markdownPath, 'utf8');
    expect(markdown).toContain('![First](../../../../assets/');
    expect(markdown).toContain('![Second](../../../../assets/');
    expect(markdown).not.toContain('](asset:');
  });

  it('rejects an unknown step before importing an asset', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-attach-invalid-step-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    const document = { id: 'document:invalid-step', featureId: 'feature:invalid-step', title: 'Invalid step', roles: [], scenarios: [], steps: [{ id: 'step:valid', title: 'Valid', instruction: { text: 'Do it', evidenceIds: [], confidence: 'inferred' as const }, screenshots: [] }], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1 };
    persistence.saveDocument(document, 'needs_review', path.join(root, 'revision-1.md')); persistence.close();
    const png = path.join(root, 'screenshot.png'); await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    await expect(new AttachScreenshotUseCase().execute(root, document.id, 'step:missing', png, 'Missing')).rejects.toThrow('Document section not found');
    const verification = new Persistence(root); expect(verification.db.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 0 }); verification.close();
  });
});

describe('ClassifyDocumentUseCase', () => {
  it('preserves the approved revision and assets while creating a classified revision that requires review', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-classify-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    await writeFile(path.join(root, '.bizdoc', 'project.yaml'), `version: 1\nproject:\n  name: sales-crm\n  display_name: 销售 CRM\nsources:\n  frontend: { path: ./frontend, framework: react }\n  backend: { path: ./backend, framework: spring-boot }\nanalysis: { include: [src/**], exclude: [], mappings: [] }\n`);
    const assetPath = path.join(root, '.bizdoc', 'assets', 'page.png'); await mkdir(path.dirname(assetPath), { recursive: true }); await writeFile(assetPath, 'fixture');
    const document = {
      id: 'document:legacy', featureId: 'feature:legacy', title: '线索转化操作说明', roles: [], scenarios: [],
      steps: [{ id: 'step:1', title: '转化', instruction: { text: '点击转化', evidenceIds: [], confidence: 'inferred' as const }, screenshots: [{ assetId: 'asset:page', alt: '线索转化页面' }] }],
      fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [],
      reviewItems: [{ id: 'review:legacy', sectionId: 'document:legacy', message: '复核内容', severity: 'blocking' as const }],
      sourceSnapshotId: 'snapshot:legacy', sourceCommits: { frontend: 'front-commit', backend: 'back-commit' }, revision: 1
    };
    const persistence = new Persistence(root); persistence.migrate();
    persistence.saveAsset({ id: 'asset:page', hash: 'fixture-hash', mimeType: 'image/png', path: assetPath, width: 1, height: 1, size: 7 });
    persistence.saveDocument(document, 'needs_review', path.join(root, 'revision-1.md')); persistence.approveDocument(document.id, 1);
    const oldRevision = persistence.db.prepare('SELECT model_json,status,markdown_path FROM document_revisions WHERE document_id=? AND revision=1').get(document.id);
    const oldAsset = persistence.db.prepare('SELECT * FROM assets WHERE id=?').get('asset:page'); persistence.close();

    const result = await new ClassifyDocumentUseCase().execute(root, document.id, '线索管理', 'module:confirmed-leads');
    expect(result).toMatchObject({ status: 'needs_review', document: { revision: 2, classification: { system: { name: '销售 CRM' }, module: { id: 'module:confirmed-leads', name: '线索管理' } } } });
    expect(result.document.steps).toEqual(document.steps);
    expect(result.document.sourceSnapshotId).toBe(document.sourceSnapshotId); expect(result.document.sourceCommits).toEqual(document.sourceCommits);
    expect(result.document.reviewItems.slice(0, -1)).toEqual(document.reviewItems);
    const markdown = await readFile(result.markdownPath, 'utf8');
    expect(markdown).toContain('所属系统：销售 CRM'); expect(markdown).toContain('业务模块：线索管理'); expect(markdown).toContain('![线索转化页面](../../../../assets/page.png)');
    const verification = new Persistence(root);
    expect(verification.db.prepare('SELECT model_json,status,markdown_path FROM document_revisions WHERE document_id=? AND revision=1').get(document.id)).toEqual(oldRevision);
    expect(verification.db.prepare('SELECT * FROM assets WHERE id=?').get('asset:page')).toEqual(oldAsset);
    expect(verification.db.prepare('SELECT COUNT(*) AS count FROM assets').get()).toEqual({ count: 1 });
    expect(verification.getDocument(document.id, 1)).toMatchObject({ status: 'approved', model: expect.not.objectContaining({ classification: expect.anything() }) });
    expect(verification.getDocument(document.id)).toMatchObject({ status: 'needs_review', revision: 2 });
    expect(verification.unresolvedBlockingReviewItems(document.id, 2)).toEqual(['review:legacy', `${document.id}:review:classification:2`]);
    verification.close();

    const publish = vi.fn<Publisher['publish']>().mockResolvedValue({ nodeToken: 'node', documentToken: 'doc', created: true });
    await expect(new PublishDocumentUseCase().execute(root, document.id, 'target:test', { publish })).rejects.toThrow('REVIEW_REQUIRED');
    expect(publish).not.toHaveBeenCalled();
    new ReviewDocumentUseCase().execute(root, document.id, 2);
    await expect(new PublishDocumentUseCase().execute(root, document.id, 'target:test', { publish })).resolves.toMatchObject({ nodeToken: 'node' });
  });

  it.each(['', '   ', '未分类'] as const)('reclassifies the placeholder module name %j without changing the approved revision', async (placeholderName) => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-classify-placeholder-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    await writeFile(path.join(root, '.bizdoc', 'project.yaml'), `version: 1\nproject:\n  name: sales-crm\n  display_name: 销售 CRM\nsources:\n  frontend: { path: ./frontend, framework: react }\n  backend: { path: ./backend, framework: spring-boot }\nanalysis: { include: [src/**], exclude: [], mappings: [] }\n`);
    const document = {
      id: 'document:placeholder', featureId: 'feature:placeholder', title: 'Placeholder',
      classification: { system: { id: 'system:crm', name: '销售 CRM' }, module: { id: 'module:placeholder', name: placeholderName } },
      roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1
    };
    const persistence = new Persistence(root); persistence.migrate(); persistence.saveDocument(document, 'approved', '/tmp/revision-1.md');
    const original = persistence.db.prepare('SELECT model_json,status FROM document_revisions WHERE document_id=? AND revision=1').get(document.id); persistence.close();

    await expect(new ClassifyDocumentUseCase().execute(root, document.id, '线索管理')).resolves.toMatchObject({
      status: 'needs_review', document: { revision: 2, classification: { module: { name: '线索管理' } } }
    });
    const verification = new Persistence(root);
    expect(verification.db.prepare('SELECT model_json,status FROM document_revisions WHERE document_id=? AND revision=1').get(document.id)).toEqual(original);
    expect(verification.getDocument(document.id)).toMatchObject({ revision: 2, status: 'needs_review' }); verification.close();
  });

  it.each([
    ['an unregistered screenshot', false, 'SCREENSHOT_ASSET_MISSING'],
    ['a missing screenshot file', true, 'SCREENSHOT_ASSET_UNAVAILABLE']
  ] as const)('does not create a revision when the legacy document references %s', async (_label, registerAsset, expectedError) => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-classify-missing-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    await writeFile(path.join(root, '.bizdoc', 'project.yaml'), `version: 1\nproject: { name: crm }\nsources:\n  frontend: { path: ./frontend, framework: react }\n  backend: { path: ./backend, framework: spring-boot }\nanalysis: { include: [src/**], exclude: [], mappings: [] }\n`);
    const document = { id: 'document:missing', featureId: 'feature:missing', title: 'Missing asset', roles: [], scenarios: [], steps: [{ id: 'step:1', title: 'Step', instruction: { text: 'Do it', evidenceIds: [], confidence: 'inferred' as const }, screenshots: [{ assetId: 'asset:missing', alt: 'Missing' }] }], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1 };
    const persistence = new Persistence(root); persistence.migrate();
    if (registerAsset) persistence.saveAsset({ id: 'asset:missing', hash: 'missing-hash', mimeType: 'image/png', path: path.join(root, '.bizdoc', 'assets', 'missing.png'), width: 1, height: 1, size: 1 });
    persistence.saveDocument(document, 'approved', path.join(root, 'revision-1.md')); persistence.close();

    await expect(new ClassifyDocumentUseCase().execute(root, document.id, '线索管理')).rejects.toThrow(expectedError);
    const verification = new Persistence(root);
    expect(verification.db.prepare('SELECT COUNT(*) AS count FROM document_revisions WHERE document_id=?').get(document.id)).toEqual({ count: 1 });
    expect(verification.getDocument(document.id)).toMatchObject({ revision: 1, status: 'approved' }); verification.close();
    await expect(access(path.join(root, '.bizdoc', 'output', 'documents', 'document-missing', 'revision-2'))).rejects.toThrow();
  });

  it('rejects unapproved, placeholder-module, and repeated classification attempts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-classify-reject-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    await writeFile(path.join(root, '.bizdoc', 'project.yaml'), `version: 1\nproject: { name: crm }\nsources:\n  frontend: { path: ./frontend, framework: react }\n  backend: { path: ./backend, framework: spring-boot }\nanalysis: { include: [src/**], exclude: [], mappings: [] }\n`);
    const base = { id: 'document:legacy', featureId: 'feature:legacy', title: 'Legacy', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [] };
    const persistence = new Persistence(root); persistence.migrate(); persistence.saveDocument({ ...base, revision: 1 }, 'needs_review', '/tmp/revision-1.md'); persistence.close();
    const useCase = new ClassifyDocumentUseCase();
    await expect(useCase.execute(root, base.id, '线索管理')).rejects.toThrow('REVIEW_REQUIRED');
    const approval = new Persistence(root); approval.approveDocument(base.id, 1); approval.close();
    await expect(useCase.execute(root, base.id, '未分类')).rejects.toThrow('A confirmed business module name is required');
    await expect(useCase.execute(root, base.id, '线索管理', '   ')).rejects.toThrow('non-empty --module-id');
    await expect(useCase.execute(root, base.id, '线索管理')).resolves.toMatchObject({ document: { revision: 2 } });
    await expect(useCase.execute(root, base.id, '其他模块')).rejects.toThrow('DOCUMENT_ALREADY_CLASSIFIED');
    const verification = new Persistence(root); expect(verification.db.prepare('SELECT COUNT(*) AS count FROM document_revisions').get()).toEqual({ count: 2 }); verification.close();
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
      expect(firstDocument.classification).toEqual({
        system: { id: expect.stringMatching(/^system:/), name: 'fixture' },
        module: { id: expect.stringMatching(/^module:/), name: '未分类' }
      });
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
