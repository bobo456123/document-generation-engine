import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Persistence } from './index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('persistence migrations', () => {
  it('creates every MVP table and can run twice', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-db-'));
    roots.push(root);
    await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root);
    expect(persistence.orm).toBeDefined();
    persistence.migrate();
    persistence.migrate();
    const rows = persistence.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    const names = rows.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining([
      'projects', 'analysis_runs', 'code_facts', 'business_snapshots', 'business_features',
      'documents', 'document_revisions', 'review_item_resolutions', 'assets', 'publication_targets', 'publications', 'publication_node_mappings'
    ]));
    const publicationColumns = (persistence.db.prepare('PRAGMA table_info(publications)').all() as Array<{ name: string }>).map((column) => column.name);
    expect(publicationColumns).toEqual(expect.arrayContaining(['error_category', 'started_at', 'finished_at']));
    persistence.close();
  });

  it('migrates a v0.1 database without losing legacy revisions or publication mappings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-db-v01-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root);
    persistence.db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE analysis_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, commit_json TEXT, metrics_json TEXT, error_json TEXT, created_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE code_facts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, fact_json TEXT NOT NULL);
      CREATE TABLE business_snapshots (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE business_features (id TEXT NOT NULL, snapshot_id TEXT NOT NULL, feature_json TEXT NOT NULL, PRIMARY KEY(id, snapshot_id));
      CREATE TABLE documents (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, status TEXT NOT NULL, current_revision INTEGER NOT NULL);
      CREATE TABLE document_revisions (document_id TEXT NOT NULL, revision INTEGER NOT NULL, model_json TEXT NOT NULL, markdown_path TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(document_id, revision));
      CREATE TABLE review_item_resolutions (document_id TEXT NOT NULL, revision INTEGER NOT NULL, review_item_id TEXT NOT NULL, resolved_at TEXT NOT NULL, PRIMARY KEY(document_id, revision, review_item_id));
      CREATE TABLE assets (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, path TEXT NOT NULL, metadata_json TEXT NOT NULL);
      CREATE TABLE publication_targets (id TEXT PRIMARY KEY, provider TEXT NOT NULL, config_json TEXT NOT NULL);
      CREATE TABLE publications (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, revision INTEGER NOT NULL, target_id TEXT NOT NULL, remote_node_token TEXT, remote_document_token TEXT, status TEXT NOT NULL, error_category TEXT, result_json TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE security_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    `);
    const legacy = { id: 'document:legacy', featureId: 'feature:legacy', title: 'Legacy', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1 };
    persistence.db.prepare('INSERT INTO documents(id,feature_id,status,current_revision) VALUES(?,?,?,?)').run(legacy.id, legacy.featureId, 'approved', 1);
    persistence.db.prepare('INSERT INTO document_revisions(document_id,revision,model_json,markdown_path,status,created_at) VALUES(?,?,?,?,?,?)').run(legacy.id, 1, JSON.stringify(legacy), '/legacy.md', 'approved', '2026-08-23T00:00:00.000Z');
    persistence.db.prepare('INSERT INTO publications(id,document_id,revision,target_id,remote_node_token,remote_document_token,status,result_json,started_at,finished_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('publication:legacy', legacy.id, 1, 'feishu:space', 'node:legacy', 'doc:legacy', 'completed', '{}', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:01.000Z', '2026-08-23T00:00:01.000Z');
    persistence.migrate();
    const migrated = persistence.getDocument(legacy.id);
    expect(migrated).toMatchObject({ revision: 1, status: 'approved', model: expect.objectContaining({ title: 'Legacy' }) });
    expect(migrated.model).not.toHaveProperty('classification');
    expect(persistence.publicationMapping(legacy.id, 'feishu:space')).toEqual({ nodeToken: 'node:legacy', documentToken: 'doc:legacy' });
    expect(persistence.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='publication_node_mappings'").get()).toEqual({ count: 1 });
    persistence.close();
  });

  it('redacts sensitive values from historical JSON records idempotently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-db-redaction-'));
    roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    const secret = 'fixture-persisted-secret-123456';
    const fact = {
      id: 'fact:secret', kind: 'STATE_CHANGE', name: 'appSecret', value: secret, confidence: 'verified',
      evidence: { id: 'evidence:secret', source: 'SOURCE_CODE', file: 'Config.java', symbol: 'Config.appSecret', excerpt: `appSecret = "${secret}"` }
    };
    persistence.db.prepare('INSERT INTO code_facts(id,run_id,fact_json) VALUES(?,?,?)').run('row:1', 'run:1', JSON.stringify(fact));
    persistence.db.prepare('INSERT INTO business_snapshots(id,run_id,snapshot_json,created_at) VALUES(?,?,?,?)')
      .run('snapshot:1', 'run:1', JSON.stringify({ facts: [fact], rules: [{ text: secret }] }), new Date(0).toISOString());
    expect(persistence.sanitizeStoredSensitiveData()).toBe(2);
    expect(persistence.sanitizeStoredSensitiveData()).toBe(0);
    const stored = JSON.stringify([
      persistence.db.prepare('SELECT fact_json FROM code_facts').all(),
      persistence.db.prepare('SELECT snapshot_json FROM business_snapshots').all()
    ]);
    expect(stored).not.toContain(secret);
    expect(stored).toContain('[REDACTED]');
    persistence.close();
  });

  it('returns the latest document revision for zero-argument preview', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-db-preview-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    const base = { id: 'document:preview', featureId: 'feature:preview', title: 'Preview', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [] };
    persistence.saveDocument({ ...base, revision: 1 }, 'draft', '/tmp/revision-1.md');
    persistence.saveDocument({ ...base, revision: 2 }, 'needs_review', '/tmp/revision-2.md');
    expect(persistence.latestDocument()).toMatchObject({ id: base.id, revision: 2, markdownPath: '/tmp/revision-2.md', status: 'needs_review' });
    expect(persistence.listDocuments()).toEqual([expect.objectContaining({ id: base.id, title: 'Preview', revision: 2, status: 'needs_review' })]);
    persistence.close();
  });

  it('upserts stable publication node mappings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-db-publication-tree-')); roots.push(root); await mkdir(path.join(root, '.bizdoc'));
    const persistence = new Persistence(root); persistence.migrate();
    persistence.savePublicationNodeMapping({ targetId: 'feishu:space', localNodeId: 'system:crm', nodeKind: 'system', title: 'CRM', nodeToken: 'node-1', documentToken: 'doc-1' });
    persistence.savePublicationNodeMapping({ targetId: 'feishu:space', localNodeId: 'system:crm', nodeKind: 'system', title: '销售 CRM', nodeToken: 'node-1', documentToken: 'doc-1' });
    expect(persistence.publicationNodeMapping('feishu:space', 'system:crm')).toEqual({ nodeToken: 'node-1', documentToken: 'doc-1', title: '销售 CRM' });
    persistence.close();
  });
});
