import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const evidenceSourceSchema = z.enum(['SOURCE_CODE', 'SOURCE_CONFIG', 'SOURCE_COMMENT', 'AI_INFERENCE', 'MANUAL_INPUT']);
export const confidenceSchema = z.enum(['verified', 'inferred', 'conflicted']);

export const evidenceSchema = z.object({
  id: z.string(),
  source: evidenceSourceSchema,
  repository: z.string().optional(),
  commit: z.string().optional(),
  file: z.string(),
  symbol: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  excerpt: z.string().max(1000).optional()
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const codeFactSchema = z.object({
  id: z.string(),
  kind: z.enum(['ROUTE', 'PAGE', 'ACTION', 'FORM_FIELD', 'API_CALL', 'NAVIGATION', 'MESSAGE', 'HTTP_ENDPOINT', 'SERVICE_CALL', 'ENTITY', 'DTO', 'ENUM', 'DATA_ACCESS', 'VALIDATION', 'PERMISSION', 'STATE_CHANGE', 'CONDITION', 'EXCEPTION', 'MAPPING']),
  name: z.string(),
  method: z.string().optional(),
  path: z.string().optional(),
  owner: z.string().optional(),
  target: z.string().optional(),
  value: z.string().optional(),
  confidence: confidenceSchema,
  evidence: evidenceSchema
});
export type CodeFact = z.infer<typeof codeFactSchema>;

export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_IDENTIFIER = /(?:^|[^a-z0-9])(?:authorization|credential|password|passwd|pwd|token|secret|api[_-]?key|app[_-]?(?:id|key|secret)|client[_-]?(?:id|key|secret)|access[_-]?key)(?:$|[^a-z0-9])/i;

function normalizedIdentifier(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
}

export function isSensitiveIdentifier(value: string | undefined): boolean {
  return value !== undefined && SENSITIVE_IDENTIFIER.test(`_${normalizedIdentifier(value)}_`);
}

export function redactSensitiveText(input: string): string {
  const key = String.raw`(?:authorization|credential|password|passwd|pwd|token|secret|api[_-]?key|app[_-]?(?:id|key|secret)|client[_-]?(?:id|key|secret)|access[_-]?key)`;
  return input
    .replace(/(\bauthorization\b\s*[:=]\s*)["']?bearer\s+[^\s"',;)}]+/gi, `$1${REDACTED_VALUE}`)
    .replace(new RegExp(`(\\b(?:set)?${key}\\s*\\(\\s*)([\\"'\\x60])([^\\"'\\x60\\r\\n]+)\\2`, 'gi'), `$1$2${REDACTED_VALUE}$2`)
    .replace(new RegExp(`(\\b${key}\\b\\s*(?:=|:)\\s*)([\\"'\\x60])([^\\"'\\x60\\r\\n]+)\\2`, 'gi'), `$1$2${REDACTED_VALUE}$2`)
    .replace(new RegExp(`(\\b${key}\\b\\s*(?:=|:)\\s*)(?![\\"'\\x60])([^\\s,;&)}]+)`, 'gi'), `$1${REDACTED_VALUE}`)
    .replace(/([?&](?:app_?id|app_?secret|access_?token|token|api_?key)=)[^&\s]+/gi, `$1${REDACTED_VALUE}`);
}

export function sanitizeCodeFact(fact: CodeFact): CodeFact {
  const sensitiveValue = [fact.name, fact.owner, fact.target, fact.evidence.symbol].some(isSensitiveIdentifier);
  const sanitize = (value: string | undefined, force = false): string | undefined => {
    if (value === undefined) return undefined;
    return force ? REDACTED_VALUE : redactSensitiveText(value);
  };
  return codeFactSchema.parse({
    ...fact,
    ...(fact.method === undefined ? {} : { method: sanitize(fact.method) }),
    ...(fact.path === undefined ? {} : { path: sanitize(fact.path) }),
    ...(fact.owner === undefined ? {} : { owner: sanitize(fact.owner) }),
    ...(fact.target === undefined ? {} : { target: sanitize(fact.target) }),
    ...(fact.value === undefined ? {} : { value: sanitize(fact.value, sensitiveValue) }),
    evidence: {
      ...fact.evidence,
      ...(fact.evidence.excerpt === undefined ? {} : { excerpt: redactSensitiveText(fact.evidence.excerpt) })
    }
  });
}

export function sanitizeCodeFacts(facts: CodeFact[]): CodeFact[] {
  return facts.map(sanitizeCodeFact);
}

export function sanitizeStructuredData(input: unknown, knownSensitiveValues: string[] = []): unknown {
  const candidates = [...new Set(knownSensitiveValues)]
    .filter((value) => value.length >= 8 && value.length <= 512 && !/\s/.test(value) && value !== REDACTED_VALUE)
    .sort((left, right) => right.length - left.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const knownPattern = candidates.length ? new RegExp(candidates.join('|'), 'g') : undefined;
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return redactSensitiveText(knownPattern ? value.replace(knownPattern, REDACTED_VALUE) : value);
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      isSensitiveIdentifier(key) && typeof child === 'string' ? REDACTED_VALUE : visit(child)
    ]));
  };
  return visit(input);
}

export function sensitiveValuesFromFacts(facts: CodeFact[]): string[] {
  return [...new Set(facts.flatMap((fact) => {
    const sensitive = [fact.name, fact.owner, fact.target, fact.evidence.symbol].some(isSensitiveIdentifier);
    return sensitive && fact.value && fact.value !== REDACTED_VALUE ? [fact.value] : [];
  }))];
}

export const businessFeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  module: z.string(),
  entry: z.object({ route: z.string().optional(), page: z.string().optional(), action: z.string().optional() }).optional(),
  roles: z.array(z.object({ value: z.string(), evidenceIds: z.array(z.string()) })),
  frontendRefs: z.array(z.string()),
  backendRefs: z.array(z.string()),
  apiRefs: z.array(z.object({ method: z.string(), path: z.string(), evidenceIds: z.array(z.string()) })),
  entities: z.array(z.string()),
  fields: z.array(z.object({ name: z.string(), required: z.boolean().optional(), evidenceIds: z.array(z.string()) })),
  rules: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()) })),
  outcomes: z.array(z.object({ value: z.string(), evidenceIds: z.array(z.string()) })),
  confidence: confidenceSchema,
  evidenceIds: z.array(z.string())
});
export type BusinessFeature = z.infer<typeof businessFeatureSchema>;

export const businessSnapshotSchema = z.object({
  id: z.string(),
  runId: z.string(),
  createdAt: z.string(),
  commits: z.record(z.string(), z.string().nullable()),
  features: z.array(businessFeatureSchema),
  facts: z.array(codeFactSchema),
  unlinkedFrontendFactIds: z.array(z.string()),
  unlinkedBackendFactIds: z.array(z.string()),
  conflicts: z.array(z.object({ message: z.string(), factIds: z.array(z.string()) })),
  diagnostics: z.object({ parseFailures: z.array(z.string()) }).optional()
}).superRefine((snapshot, context) => {
  const evidenceIds = new Set(snapshot.facts.map((fact) => fact.evidence.id));
  for (const [featureIndex, feature] of snapshot.features.entries()) {
    const references = [
      ...feature.evidenceIds, ...feature.apiRefs.flatMap((item) => item.evidenceIds), ...feature.roles.flatMap((item) => item.evidenceIds),
      ...feature.fields.flatMap((item) => item.evidenceIds), ...feature.rules.flatMap((item) => item.evidenceIds), ...feature.outcomes.flatMap((item) => item.evidenceIds)
    ];
    for (const evidenceId of references) {
      if (!evidenceIds.has(evidenceId)) context.addIssue({ code: 'custom', path: ['features', featureIndex, 'evidenceIds'], message: `Dangling evidence ID: ${evidenceId}` });
    }
  }
});
export type BusinessModelSnapshot = z.infer<typeof businessSnapshotSchema>;

export function stableId(prefix: string, ...parts: Array<string | undefined>): string {
  const hash = createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16);
  return `${prefix}:${hash}`;
}

export const newRunId = (): string => `run:${randomUUID()}`;

export function normalizeHttpPath(input: string): string {
  let value = input.trim().replace(/[`'"{}$]/g, '').replace(/\/+/g, '/');
  value = value.replace(/:[A-Za-z_$][\w$]*/g, ':param').replace(/\/\d+(?=\/|$)/g, '/:param');
  if (!value.startsWith('/')) value = `/${value}`;
  return value.length > 1 ? value.replace(/\/$/, '') : value;
}
