import Database from 'better-sqlite3';
import path from 'node:path';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema.js';
export * from './schema.js';

const migration = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, commit_json TEXT, metrics_json TEXT, error_json TEXT, created_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS code_facts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, fact_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS business_snapshots (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS business_features (id TEXT NOT NULL, snapshot_id TEXT NOT NULL, feature_json TEXT NOT NULL, PRIMARY KEY(id, snapshot_id));
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, status TEXT NOT NULL, current_revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS document_revisions (document_id TEXT NOT NULL, revision INTEGER NOT NULL, model_json TEXT NOT NULL, markdown_path TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(document_id, revision));
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, path TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publication_targets (id TEXT PRIMARY KEY, provider TEXT NOT NULL, config_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, revision INTEGER NOT NULL, target_id TEXT NOT NULL, remote_node_token TEXT, remote_document_token TEXT, status TEXT NOT NULL, error_category TEXT, result_json TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, created_at TEXT NOT NULL);
`;

export class Persistence {
  readonly db: Database.Database;
  readonly orm: BetterSQLite3Database<typeof schema>;

  constructor(root: string) {
    this.db = new Database(path.join(root, '.bizdoc', 'bizdoc.db'));
    this.db.pragma('journal_mode = WAL');
    this.orm = drizzle(this.db, { schema });
  }

  migrate(): void {
    this.db.exec(migration);
    const columns = new Set((this.db.prepare('PRAGMA table_info(publications)').all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has('error_category')) this.db.exec('ALTER TABLE publications ADD COLUMN error_category TEXT');
    if (!columns.has('started_at')) this.db.exec("ALTER TABLE publications ADD COLUMN started_at TEXT NOT NULL DEFAULT ''");
    if (!columns.has('finished_at')) this.db.exec("ALTER TABLE publications ADD COLUMN finished_at TEXT NOT NULL DEFAULT ''");
  }

  saveAnalysis(projectId: string, projectName: string, config: unknown, runId: string, snapshot: { id: string; features: Array<{ id: string }>; facts: Array<{ id: string }> }, metrics: unknown): void {
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO projects(id,name,config_json,created_at) VALUES(?,?,?,?)').run(projectId, projectName, JSON.stringify(config), now);
      this.db.prepare('INSERT INTO analysis_runs(id,project_id,status,metrics_json,created_at,finished_at) VALUES(?,?,?,?,?,?)').run(runId, projectId, 'completed', JSON.stringify(metrics), now, now);
      const factStmt = this.db.prepare('INSERT INTO code_facts(id,run_id,fact_json) VALUES(?,?,?)');
      for (const fact of snapshot.facts) factStmt.run(`${runId}:${fact.id}`, runId, JSON.stringify(fact));
      this.db.prepare('INSERT INTO business_snapshots(id,run_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(snapshot.id, runId, JSON.stringify(snapshot), now);
      const featureStmt = this.db.prepare('INSERT INTO business_features(id,snapshot_id,feature_json) VALUES(?,?,?)');
      for (const feature of snapshot.features) featureStmt.run(feature.id, snapshot.id, JSON.stringify(feature));
    });
    transaction();
  }

  latestSnapshot(): unknown {
    const row = this.db.prepare('SELECT snapshot_json FROM business_snapshots ORDER BY created_at DESC LIMIT 1').get() as { snapshot_json: string } | undefined;
    if (!row) throw new Error('No analysis snapshot found. Run bizdoc analyze first.');
    return JSON.parse(row.snapshot_json) as unknown;
  }

  nextRevision(documentId: string): number {
    const row = this.db.prepare('SELECT MAX(revision) AS revision FROM document_revisions WHERE document_id = ?').get(documentId) as { revision: number | null };
    return (row.revision ?? 0) + 1;
  }

  saveDocument(model: { id: string; featureId: string; revision: number }, status: 'draft' | 'needs_review' | 'approved', markdownPath: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO documents(id,feature_id,status,current_revision) VALUES(?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,current_revision=excluded.current_revision`).run(model.id, model.featureId, status, model.revision);
      this.db.prepare('INSERT INTO document_revisions(document_id,revision,model_json,markdown_path,status,created_at) VALUES(?,?,?,?,?,?)')
        .run(model.id, model.revision, JSON.stringify(model), markdownPath, status, now);
    })();
  }

  getDocument(documentId: string, revision?: number): { model: unknown; status: string; markdownPath: string | null; revision: number } {
    const row = revision === undefined
      ? this.db.prepare('SELECT model_json,status,markdown_path,revision FROM document_revisions WHERE document_id=? ORDER BY revision DESC LIMIT 1').get(documentId)
      : this.db.prepare('SELECT model_json,status,markdown_path,revision FROM document_revisions WHERE document_id=? AND revision=?').get(documentId, revision);
    if (!row) throw new Error(`Document not found: ${documentId}`);
    const typed = row as { model_json: string; status: string; markdown_path: string | null; revision: number };
    return { model: JSON.parse(typed.model_json) as unknown, status: typed.status, markdownPath: typed.markdown_path, revision: typed.revision };
  }

  approveDocument(documentId: string, revision: number): void {
    const current = this.getDocument(documentId, revision);
    this.db.transaction(() => {
      this.db.prepare('UPDATE document_revisions SET status=? WHERE document_id=? AND revision=?').run('approved', documentId, revision);
      this.db.prepare('UPDATE documents SET status=? WHERE id=? AND current_revision=?').run('approved', documentId, revision);
    })();
    if (!current) throw new Error('unreachable');
  }

  saveAsset(asset: { id: string; hash: string; mimeType: string; path: string; width: number; height: number; size: number }): string {
    const existing = this.db.prepare('SELECT id FROM assets WHERE hash=?').get(asset.hash) as { id: string } | undefined;
    if (existing) return existing.id;
    this.db.prepare('INSERT INTO assets(id,hash,mime_type,path,metadata_json) VALUES(?,?,?,?,?)').run(asset.id, asset.hash, asset.mimeType, asset.path, JSON.stringify({ width: asset.width, height: asset.height, size: asset.size }));
    return asset.id;
  }

  assets(): Record<string, { id: string; path: string; mimeType: string }> {
    const rows = this.db.prepare('SELECT id,path,mime_type FROM assets').all() as Array<{ id: string; path: string; mime_type: string }>;
    return Object.fromEntries(rows.map((row) => [row.id, { id: row.id, path: row.path, mimeType: row.mime_type }]));
  }

  publicationMapping(documentId: string, targetId: string): { nodeToken?: string; documentToken?: string } | undefined {
    const row = this.db.prepare(`SELECT remote_node_token,remote_document_token FROM publications
      WHERE document_id=? AND target_id=? AND remote_node_token IS NOT NULL AND remote_document_token IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`).get(documentId, targetId) as { remote_node_token: string | null; remote_document_token: string | null } | undefined;
    if (!row) return undefined;
    return { ...(row.remote_node_token ? { nodeToken: row.remote_node_token } : {}), ...(row.remote_document_token ? { documentToken: row.remote_document_token } : {}) };
  }

  savePublication(input: { id: string; documentId: string; revision: number; targetId: string; nodeToken?: string; documentToken?: string; status: string; errorCategory?: string; result?: unknown; startedAt: string; finishedAt: string }): void {
    this.db.prepare(`INSERT INTO publications(id,document_id,revision,target_id,remote_node_token,remote_document_token,status,error_category,result_json,started_at,finished_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, input.documentId, input.revision, input.targetId, input.nodeToken ?? null, input.documentToken ?? null, input.status, input.errorCategory ?? null, input.result === undefined ? null : JSON.stringify(input.result), input.startedAt, input.finishedAt, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
