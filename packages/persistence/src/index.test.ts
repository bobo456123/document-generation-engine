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
      'documents', 'document_revisions', 'review_item_resolutions', 'assets', 'publication_targets', 'publications'
    ]));
    const publicationColumns = (persistence.db.prepare('PRAGMA table_info(publications)').all() as Array<{ name: string }>).map((column) => column.name);
    expect(publicationColumns).toEqual(expect.arrayContaining(['error_category', 'started_at', 'finished_at']));
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
    persistence.close();
  });
});
