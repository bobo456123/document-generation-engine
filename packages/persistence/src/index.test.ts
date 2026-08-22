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
      'documents', 'document_revisions', 'assets', 'publication_targets', 'publications'
    ]));
    const publicationColumns = (persistence.db.prepare('PRAGMA table_info(publications)').all() as Array<{ name: string }>).map((column) => column.name);
    expect(publicationColumns).toEqual(expect.arrayContaining(['error_category', 'started_at', 'finished_at']));
    persistence.close();
  });
});
