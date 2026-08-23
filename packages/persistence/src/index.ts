import Database from 'better-sqlite3';
import path from 'node:path';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema.js';
import { codeFactSchema, sanitizeCodeFact, sanitizeStructuredData, sensitiveValuesFromFacts, type CodeFact } from '@bizdoc/business-model';
export * from './schema.js';

const migration = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, commit_json TEXT, metrics_json TEXT, error_json TEXT, created_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS code_facts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, fact_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS business_snapshots (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS business_features (id TEXT NOT NULL, snapshot_id TEXT NOT NULL, feature_json TEXT NOT NULL, PRIMARY KEY(id, snapshot_id));
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL, status TEXT NOT NULL, current_revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS document_revisions (document_id TEXT NOT NULL, revision INTEGER NOT NULL, model_json TEXT NOT NULL, markdown_path TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(document_id, revision));
CREATE TABLE IF NOT EXISTS review_item_resolutions (document_id TEXT NOT NULL, revision INTEGER NOT NULL, review_item_id TEXT NOT NULL, resolved_at TEXT NOT NULL, PRIMARY KEY(document_id, revision, review_item_id));
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL, path TEXT NOT NULL, metadata_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publication_targets (id TEXT PRIMARY KEY, provider TEXT NOT NULL, config_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, revision INTEGER NOT NULL, target_id TEXT NOT NULL, remote_node_token TEXT, remote_document_token TEXT, status TEXT NOT NULL, error_category TEXT, result_json TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS security_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
`;

const SENSITIVE_DATA_MIGRATION = '2026-08-sensitive-data-redaction';
const REVIEW_RESOLUTION_MIGRATION = '2026-08-review-item-resolutions';

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
    const securityMigration = this.db.prepare('SELECT id FROM security_migrations WHERE id=?').get(SENSITIVE_DATA_MIGRATION);
    if (!securityMigration) {
      this.sanitizeStoredSensitiveData();
      this.db.prepare('INSERT INTO security_migrations(id,applied_at) VALUES(?,?)').run(SENSITIVE_DATA_MIGRATION, new Date().toISOString());
    }
    const reviewMigration = this.db.prepare('SELECT id FROM security_migrations WHERE id=?').get(REVIEW_RESOLUTION_MIGRATION);
    if (!reviewMigration) {
      const approved = this.db.prepare("SELECT document_id,revision,model_json FROM document_revisions WHERE status='approved'").all() as Array<{ document_id: string; revision: number; model_json: string }>;
      const resolution = this.db.prepare('INSERT OR IGNORE INTO review_item_resolutions(document_id,revision,review_item_id,resolved_at) VALUES(?,?,?,?)');
      const now = new Date().toISOString();
      this.db.transaction(() => {
        for (const row of approved) {
          try {
            const model = JSON.parse(row.model_json) as { reviewItems?: Array<{ id?: unknown }> };
            for (const item of model.reviewItems ?? []) if (typeof item.id === 'string') resolution.run(row.document_id, row.revision, item.id, now);
          } catch { /* Malformed historical revisions remain unresolved. */ }
        }
        this.db.prepare('INSERT INTO security_migrations(id,applied_at) VALUES(?,?)').run(REVIEW_RESOLUTION_MIGRATION, now);
      })();
    }
  }

  sanitizeStoredSensitiveData(): number {
    const factRows = this.db.prepare('SELECT rowid,fact_json FROM code_facts').all() as Array<{ rowid: number; fact_json: string }>;
    const originalFacts = new Map(factRows.map((row) => [row.rowid, row.fact_json]));
    const parsedFacts: Array<{ rowid: number; fact: CodeFact }> = [];
    for (const row of factRows) {
      try { parsedFacts.push({ rowid: row.rowid, fact: codeFactSchema.parse(JSON.parse(row.fact_json)) }); } catch { /* Preserve malformed historical rows for explicit diagnosis. */ }
    }
    const knownSensitiveValues = sensitiveValuesFromFacts(parsedFacts.map(({ fact }) => fact));
    let changed = 0;
    const updateJsonColumn = (table: string, column: string): void => {
      const rows = this.db.prepare(`SELECT rowid,${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all() as Array<{ rowid: number; value: string }>;
      const update = this.db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);
      for (const row of rows) {
        try {
          const sanitized = JSON.stringify(sanitizeStructuredData(JSON.parse(row.value), knownSensitiveValues));
          if (sanitized !== row.value) { update.run(sanitized, row.rowid); changed += 1; }
        } catch { /* Non-JSON historical values are handled by their owning feature. */ }
      }
    };
    this.db.transaction(() => {
      const updateFact = this.db.prepare('UPDATE code_facts SET fact_json=? WHERE rowid=?');
      for (const { rowid, fact } of parsedFacts) {
        const sanitized = JSON.stringify(sanitizeCodeFact(fact));
        const original = originalFacts.get(rowid);
        if (sanitized !== original) { updateFact.run(sanitized, rowid); changed += 1; }
      }
      updateJsonColumn('projects', 'config_json');
      updateJsonColumn('analysis_runs', 'commit_json');
      updateJsonColumn('analysis_runs', 'metrics_json');
      updateJsonColumn('analysis_runs', 'error_json');
      updateJsonColumn('business_snapshots', 'snapshot_json');
      updateJsonColumn('business_features', 'feature_json');
      updateJsonColumn('document_revisions', 'model_json');
      updateJsonColumn('assets', 'metadata_json');
      updateJsonColumn('publication_targets', 'config_json');
      updateJsonColumn('publications', 'result_json');
    })();
    return changed;
  }

  saveAnalysis(projectId: string, projectName: string, config: unknown, runId: string, snapshot: { id: string; features: Array<{ id: string }>; facts: Array<{ id: string }> }, metrics: unknown): void {
    const now = new Date().toISOString();
    const facts = snapshot.facts.flatMap((fact) => { const parsed = codeFactSchema.safeParse(fact); return parsed.success ? [parsed.data] : []; });
    const safeSnapshot = sanitizeStructuredData(snapshot, sensitiveValuesFromFacts(facts)) as typeof snapshot;
    const transaction = this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO projects(id,name,config_json,created_at) VALUES(?,?,?,?)').run(projectId, projectName, JSON.stringify(sanitizeStructuredData(config)), now);
      this.db.prepare('INSERT INTO analysis_runs(id,project_id,status,metrics_json,created_at,finished_at) VALUES(?,?,?,?,?,?)').run(runId, projectId, 'completed', JSON.stringify(metrics), now, now);
      const factStmt = this.db.prepare('INSERT INTO code_facts(id,run_id,fact_json) VALUES(?,?,?)');
      for (const fact of safeSnapshot.facts) factStmt.run(`${runId}:${fact.id}`, runId, JSON.stringify(fact));
      this.db.prepare('INSERT INTO business_snapshots(id,run_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(safeSnapshot.id, runId, JSON.stringify(safeSnapshot), now);
      const featureStmt = this.db.prepare('INSERT INTO business_features(id,snapshot_id,feature_json) VALUES(?,?,?)');
      for (const feature of safeSnapshot.features) featureStmt.run(feature.id, safeSnapshot.id, JSON.stringify(feature));
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

  saveDocument(model: { id: string; featureId: string; revision: number } & Record<string, unknown>, status: 'draft' | 'needs_review' | 'approved', markdownPath: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO documents(id,feature_id,status,current_revision) VALUES(?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,current_revision=excluded.current_revision`).run(model.id, model.featureId, status, model.revision);
      this.db.prepare('INSERT INTO document_revisions(document_id,revision,model_json,markdown_path,status,created_at) VALUES(?,?,?,?,?,?)')
        .run(model.id, model.revision, JSON.stringify(sanitizeStructuredData(model)), markdownPath, status, now);
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

  latestDocument(): { id: string; model: unknown; status: string; markdownPath: string | null; revision: number } {
    const row = this.db.prepare('SELECT document_id,model_json,status,markdown_path,revision FROM document_revisions ORDER BY created_at DESC,revision DESC LIMIT 1').get();
    if (!row) throw new Error('No document revision found. Run bizdoc generate first.');
    const typed = row as { document_id: string; model_json: string; status: string; markdown_path: string | null; revision: number };
    return { id: typed.document_id, model: JSON.parse(typed.model_json) as unknown, status: typed.status, markdownPath: typed.markdown_path, revision: typed.revision };
  }

  approveDocument(documentId: string, revision: number): void {
    const current = this.getDocument(documentId, revision);
    const model = current.model as { reviewItems?: Array<{ id?: unknown }> };
    const reviewItemIds = (model.reviewItems ?? []).flatMap((item) => typeof item.id === 'string' ? [item.id] : []);
    this.db.transaction(() => {
      this.db.prepare('UPDATE document_revisions SET status=? WHERE document_id=? AND revision=?').run('approved', documentId, revision);
      this.db.prepare('UPDATE documents SET status=? WHERE id=? AND current_revision=?').run('approved', documentId, revision);
      const resolve = this.db.prepare('INSERT OR IGNORE INTO review_item_resolutions(document_id,revision,review_item_id,resolved_at) VALUES(?,?,?,?)');
      const now = new Date().toISOString();
      for (const reviewItemId of reviewItemIds) resolve.run(documentId, revision, reviewItemId, now);
    })();
    if (!current) throw new Error('unreachable');
  }

  unresolvedBlockingReviewItems(documentId: string, revision: number): string[] {
    const current = this.getDocument(documentId, revision);
    const model = current.model as { reviewItems?: Array<{ id?: unknown; severity?: unknown }> };
    const resolved = new Set((this.db.prepare('SELECT review_item_id FROM review_item_resolutions WHERE document_id=? AND revision=?').all(documentId, revision) as Array<{ review_item_id: string }>).map((row) => row.review_item_id));
    return (model.reviewItems ?? []).flatMap((item) => typeof item.id === 'string' && item.severity === 'blocking' && !resolved.has(item.id) ? [item.id] : []);
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
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id, input.documentId, input.revision, input.targetId, input.nodeToken ?? null, input.documentToken ?? null, input.status, input.errorCategory ?? null, input.result === undefined ? null : JSON.stringify(sanitizeStructuredData(input.result)), input.startedAt, input.finishedAt, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
