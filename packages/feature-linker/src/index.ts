import { normalizeHttpPath, stableId, type BusinessFeature, type BusinessModelSnapshot, type CodeFact } from '@bizdoc/business-model';
import path from 'node:path';

export interface ExplicitMapping { frontend: { method: string; path: string }; backend: { method: string; path: string }; label?: string | undefined }
export interface LinkInput { runId: string; facts: CodeFact[]; commits: Record<string, string | null>; mappings?: ExplicitMapping[] }

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function componentStem(value: string): string {
  return value.replace(/(?:ServiceImpl|Service|Mapper|Repository)$/i, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}
function relatedBackendFacts(endpoint: CodeFact, facts: CodeFact[]): CodeFact[] {
  const repositoryFacts = facts.filter((fact) => fact.evidence.repository === endpoint.evidence.repository);
  const endpointExcerpt = endpoint.evidence.excerpt ?? '';
  const endpointLine = endpoint.evidence.startLine ?? 0;
  const nextEndpointLine = repositoryFacts.filter((fact) => fact.kind === 'HTTP_ENDPOINT' && fact.evidence.file === endpoint.evidence.file
    && (fact.evidence.startLine ?? 0) > endpointLine).map((fact) => fact.evidence.startLine ?? Number.MAX_SAFE_INTEGER).sort((a, b) => a - b)[0] ?? Number.MAX_SAFE_INTEGER;
  const direct = repositoryFacts.filter((fact) => (fact.evidence.file === endpoint.evidence.file && (fact.evidence.startLine ?? 0) >= endpointLine
      && (fact.evidence.startLine ?? 0) < nextEndpointLine)
    || (fact.kind === 'VALIDATION' && fact.owner !== undefined && endpointExcerpt.includes(fact.owner)));
  const pending = direct.filter((fact) => fact.kind === 'SERVICE_CALL' && fact.target).map((call) => ({ call, localDepth: 0 }));
  const serviceFacts: CodeFact[] = []; const visitedOwners = new Set<string>();
  while (pending.length) {
    const queued = pending.shift(); const call = queued?.call; if (!call?.target || queued === undefined) continue;
    const method = call.name.split('.').at(-1); if (!method) continue;
    const matchingOwners = repositoryFacts.flatMap((fact) => {
      if (!fact.owner?.includes('.')) return [];
      const separator = fact.owner.lastIndexOf('.'); const ownerClass = fact.owner.slice(0, separator); const ownerMethod = fact.owner.slice(separator + 1);
      return componentStem(call.target ?? '') === componentStem(ownerClass) && method === ownerMethod ? [fact.owner] : [];
    });
    for (const owner of matchingOwners) {
      if (visitedOwners.has(owner)) continue; visitedOwners.add(owner);
      const owned = repositoryFacts.filter((fact) => fact.owner === owner); serviceFacts.push(...owned);
      pending.push(...owned.filter((fact) => fact.kind === 'SERVICE_CALL' && fact.target).flatMap((next) => {
        const local = componentStem(next.target ?? '') === componentStem(owner.slice(0, owner.lastIndexOf('.')));
        const localDepth = queued.localDepth + (local ? 1 : 0);
        return localDepth <= 1 ? [{ call: next, localDepth }] : [];
      }));
    }
  }
  const dataTargets = new Set([...direct, ...serviceFacts]
    .filter((fact) => fact.kind === 'DATA_ACCESS' && fact.target).map((fact) => componentStem(fact.target ?? '')));
  const entities = repositoryFacts.filter((fact) => fact.kind === 'ENTITY' && dataTargets.has(componentStem(fact.name)));
  return [...new Map([...direct, ...serviceFacts, ...entities].map((fact) => [fact.id, fact])).values()];
}
function mergeContextFeatures(features: BusinessFeature[]): BusinessFeature[] {
  const merged = new Map<string, BusinessFeature>();
  for (const feature of features) {
    const contextKey = feature.entry?.page ? `${feature.entry.page}|${feature.entry.action ?? feature.name}` : feature.id;
    const current = merged.get(contextKey);
    if (!current) { merged.set(contextKey, feature); continue; }
    const apiRefs = [...new Map([...current.apiRefs, ...feature.apiRefs].map((api) => [`${api.method} ${api.path}`, api])).values()];
    const fields = [...new Map([...current.fields, ...feature.fields].map((field) => [field.name, field])).values()];
    merged.set(contextKey, {
      ...current,
      id: stableId('feature', contextKey), apiRefs, fields,
      frontendRefs: unique([...current.frontendRefs, ...feature.frontendRefs]), backendRefs: unique([...current.backendRefs, ...feature.backendRefs]),
      entities: unique([...current.entities, ...feature.entities]), evidenceIds: unique([...current.evidenceIds, ...feature.evidenceIds]),
      confidence: current.confidence === 'verified' && feature.confidence === 'verified' ? 'verified' : 'inferred'
    });
  }
  return [...merged.values()];
}

export class FeatureLinker {
  link(input: LinkInput): BusinessModelSnapshot {
    const frontend = input.facts.filter((fact) => fact.kind === 'API_CALL');
    const backend = input.facts.filter((fact) => fact.kind === 'HTTP_ENDPOINT');
    const usedFrontend = new Set<string>(); const usedBackend = new Set<string>(); const features: BusinessFeature[] = [];
    const conflicts: Array<{ message: string; factIds: string[] }> = [];
    const mappingFacts: CodeFact[] = [];
    for (const api of frontend) {
      const explicit = input.mappings?.find((mapping) => mapping.frontend.method.toUpperCase() === api.method && normalizeHttpPath(mapping.frontend.path) === normalizeHttpPath(api.path ?? ''));
      const matches = explicit
        ? backend.filter((endpoint) => endpoint.method === explicit.backend.method.toUpperCase() && normalizeHttpPath(endpoint.path ?? '') === normalizeHttpPath(explicit.backend.path))
        : backend.filter((endpoint) => endpoint.method === api.method && normalizeHttpPath(endpoint.path ?? '') === normalizeHttpPath(api.path ?? ''));
      if (matches.length > 1) {
        conflicts.push({ message: `Ambiguous backend endpoint for ${api.method ?? 'GET'} ${normalizeHttpPath(api.path ?? '/')}`, factIds: [api.id, ...matches.map((item) => item.id)] });
        continue;
      }
      if (matches.length !== 1) continue;
      const endpoint = matches[0]; if (!endpoint) continue;
      let mappingFact: CodeFact | undefined;
      if (explicit) {
        const mappingEvidence = { id: stableId('evidence', 'manual-mapping', api.id, endpoint.id), source: 'MANUAL_INPUT' as const, file: '.bizdoc/project.yaml', symbol: explicit.label ?? `${api.method} ${api.path}` };
        mappingFact = { id: stableId('fact', 'mapping', api.id, endpoint.id), kind: 'MAPPING', name: explicit.label ?? `${api.method} ${api.path} -> ${endpoint.method} ${endpoint.path}`, confidence: 'inferred', evidence: mappingEvidence };
        mappingFacts.push(mappingFact);
      }
      usedFrontend.add(api.id); usedBackend.add(endpoint.id);
      const frontendInvocations = input.facts.filter((fact) => fact.kind === 'SERVICE_CALL' && fact.target === api.owner && fact.evidence.repository === api.evidence.repository);
      const relatedBackend = relatedBackendFacts(endpoint, input.facts);
      const backendFields = relatedBackend.filter((fact) => fact.kind === 'VALIDATION');
      const contextFiles = [...new Set(frontendInvocations.map((fact) => fact.evidence.file).filter((file) => file !== api.evidence.file))];
      if (!contextFiles.length) contextFiles.push(api.evidence.file);
      for (const contextFile of contextFiles) {
        const relatedFrontend = input.facts.filter((fact) => fact.evidence.file === contextFile && ['ROUTE', 'PAGE', 'ACTION', 'FORM_FIELD', 'SERVICE_CALL'].includes(fact.kind));
        const evidenceIds = [...new Set([api.evidence.id, endpoint.evidence.id, ...relatedFrontend.map((fact) => fact.evidence.id), ...relatedBackend.map((fact) => fact.evidence.id), ...(mappingFact ? [mappingFact.evidence.id] : [])])];
        const action = relatedFrontend.find((fact) => fact.kind === 'ACTION'); const route = relatedFrontend.find((fact) => fact.kind === 'ROUTE');
        const frontendFields = relatedFrontend.filter((fact) => fact.kind === 'FORM_FIELD');
        const isPageContext = contextFile !== api.evidence.file;
        const componentName = isPageContext ? path.basename(contextFile, path.extname(contextFile)) : undefined;
        const name = action?.name ?? componentName ?? endpoint.name.split('.').at(-1) ?? endpoint.name;
        features.push({
          id: stableId('feature', api.method, normalizeHttpPath(api.path ?? ''), contextFile, action?.name), name, module: endpoint.owner ?? 'Unknown',
          ...((action || route || isPageContext) ? { entry: { ...(route?.path ? { route: route.path } : {}), ...(isPageContext ? { page: contextFile } : {}), ...(action ? { page: action.evidence.file, action: action.name } : {}) } } : {}), roles: [],
          frontendRefs: [api.id, ...relatedFrontend.map((fact) => fact.id)], backendRefs: [endpoint.id, ...relatedBackend.map((fact) => fact.id)],
          apiRefs: [{ method: api.method ?? 'GET', path: normalizeHttpPath(api.path ?? '/'), evidenceIds: [api.evidence.id, endpoint.evidence.id] }],
          entities: relatedBackend.filter((fact) => fact.kind === 'ENTITY').map((fact) => fact.name),
          fields: [...new Map([...frontendFields, ...backendFields].map((fact) => [fact.name, { name: fact.name, required: fact.kind === 'FORM_FIELD' || /Not/.test(fact.value ?? ''), evidenceIds: [fact.evidence.id] }])).values()],
          rules: [], outcomes: [], confidence: mappingFact || !action ? 'inferred' : 'verified', evidenceIds
        });
      }
    }
    return {
      id: stableId('snapshot', input.runId), runId: input.runId, createdAt: new Date().toISOString(), commits: input.commits,
      features: mergeContextFeatures([...new Map(features.map((feature) => [feature.id, feature])).values()]), facts: [...input.facts, ...mappingFacts],
      unlinkedFrontendFactIds: frontend.filter((fact) => !usedFrontend.has(fact.id)).map((fact) => fact.id),
      unlinkedBackendFactIds: backend.filter((fact) => !usedBackend.has(fact.id)).map((fact) => fact.id), conflicts
    };
  }
}
