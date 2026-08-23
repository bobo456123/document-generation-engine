import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';
import type { SourceInventory } from '@bizdoc/project-scanner';
import { codeFactSchema, normalizeHttpPath, sanitizeCodeFacts, stableId, type CodeFact, type Evidence } from '@bizdoc/business-model';

function lineAt(source: string, index: number): number { return source.slice(0, index).split('\n').length; }
function evFor(source: SourceInventory, file: string, text: string, index: number, symbol?: string): Evidence {
  const relative = path.relative(source.root, file); const line = lineAt(text, index);
  return { id: stableId('evidence', source.commit ?? '', relative, String(line), symbol), source: 'SOURCE_CODE', repository: source.root,
    ...(source.commit ? { commit: source.commit } : {}), file: relative, ...(symbol ? { symbol } : {}), startLine: line,
    excerpt: text.slice(index, index + 400).split('\n').slice(0, 6).join('\n') };
}
function annotationPath(text: string): string {
  return text.match(/\(\s*(?:value\s*=\s*)?["']([^"']+)["']/)?.[1] ?? '';
}
function methodOwnerAt(text: string, index: number, className: string): string {
  const methodRegex = /\b(?:public|protected|private)\s+[\w<>, ?[\].]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let owner = className;
  for (const match of text.matchAll(methodRegex)) {
    if (match.index === undefined || !match[1] || match.index > index) break;
    const open = text.indexOf('{', match.index); if (open < 0 || open > index) continue;
    let depth = 0; let close = text.length;
    for (let cursor = open; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1;
      else if (text[cursor] === '}' && --depth === 0) { close = cursor; break; }
    }
    if (index <= close) owner = `${className}.${match[1]}`;
  }
  return owner;
}
function methodRanges(text: string): Array<{ name: string; open: number; close: number }> {
  const ranges: Array<{ name: string; open: number; close: number }> = [];
  const methodRegex = /\b(?:public|protected|private)\s+[\w<>, ?[\].]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
  for (const match of text.matchAll(methodRegex)) {
    if (match.index === undefined || !match[1]) continue;
    const open = text.indexOf('{', match.index); if (open < 0) continue;
    let depth = 0; let close = text.length;
    for (let cursor = open; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1;
      else if (text[cursor] === '}' && --depth === 0) { close = cursor; break; }
    }
    ranges.push({ name: match[1], open, close });
  }
  return ranges;
}

export class SpringAnalyzer {
  readonly failures: string[] = [];

  async analyze(source: SourceInventory): Promise<CodeFact[]> {
    const facts: CodeFact[] = [];
    for (const file of source.files.filter((item) => item.endsWith('.java'))) {
      const raw = await readFile(file, 'utf8');
      let hasSyntaxError = false;
      try {
        const parser = new Parser(); parser.setLanguage(Java);
        hasSyntaxError = parser.parse(raw).rootNode.hasError;
      } catch {
        hasSyntaxError = true;
        this.failures.push(path.relative(source.root, file));
      }
      const className = raw.match(/\b(?:class|interface|enum)\s+(\w+)/)?.[1] ?? path.basename(file, '.java');
      const classMap = raw.match(/@RequestMapping\s*(\([^)]*\))?/)?.[0] ?? '';
      const basePath = annotationPath(classMap);
      const endpointRegex = /@(Get|Post|Put|Patch|Delete)Mapping\s*(\([^)]*\))?[\s\S]{0,500}?\b(?:public|protected|private)\s+([\w<>, ?[\].]+?)\s+(\w+)\s*\(([^)]*)/g;
      for (const match of raw.matchAll(endpointRegex)) {
        if (match.index === undefined || !match[1] || !match[3] || !match[4]) continue;
        const method = match[1].toUpperCase(); const endpointPath = normalizeHttpPath(`${basePath}/${annotationPath(match[2] ?? '')}`);
        const ev = evFor(source, file, raw, match.index, `${className}.${match[4]}`);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'endpoint', method, endpointPath, ev.id), kind: 'HTTP_ENDPOINT', name: `${className}.${match[4]}`, method, path: endpointPath, owner: className, target: match[3].trim(), ...(match[5]?.trim() ? { value: match[5].replace(/\s+/g, ' ').trim() } : {}), confidence: hasSyntaxError ? 'inferred' : 'verified', evidence: ev }));
      }
      const entityMatch = raw.match(/@(Entity|TableName)\b/);
      if (entityMatch?.index !== undefined) {
        const ev = evFor(source, file, raw, entityMatch.index, className);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'entity', className, ev.id), kind: 'ENTITY', name: className, confidence: 'verified', evidence: ev }));
      }
      if (/\benum\s+\w+/.test(raw)) {
        const index = raw.search(/\benum\s+\w+/); const ev = evFor(source, file, raw, index, className);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'enum', className, ev.id), kind: 'ENUM', name: className, confidence: 'verified', evidence: ev }));
      }
      if (/(?:Request|Response|Dto|DTO)$/.test(className)) {
        const index = raw.search(/\b(?:class|record)\s+/); const ev = evFor(source, file, raw, Math.max(0, index), className);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'dto', className, ev.id), kind: 'DTO', name: className, confidence: hasSyntaxError ? 'inferred' : 'verified', evidence: ev }));
      }
      const permissionRegex = /@(?:[\w.]+\.)?(PreAuthorize|Secured|RolesAllowed)\s*\(([^\n]+)\)/g;
      for (const match of raw.matchAll(permissionRegex)) {
        if (match.index === undefined || !match[1] || !match[2]) continue;
        const ev = evFor(source, file, raw, match.index, className);
        const owner = methodOwnerAt(raw, match.index, className);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'permission', owner, match[2], ev.id), kind: 'PERMISSION', name: match[1], value: match[2].trim(), owner, confidence: hasSyntaxError ? 'inferred' : 'verified', evidence: ev }));
      }
      const stateChangeRegex = /(?:\.\s*set(Status|State|Stage|Phase|Enabled|Disabled|Active)\s*\(|\b(status|state|stage|phase|enabled|disabled|active)\s*=\s*)([\w."']+)/g;
      for (const match of raw.matchAll(stateChangeRegex)) {
        if (match.index === undefined) continue;
        const field = match[1] ? `${match[1][0]?.toLowerCase()}${match[1].slice(1)}` : match[2] ?? 'status';
        const value = match[3]?.replace(/["']/g, ''); if (!value) continue;
        const ev = evFor(source, file, raw, match.index, `${className}.${field}`);
        const owner = methodOwnerAt(raw, match.index, className);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'state', owner, field, value, ev.id), kind: 'STATE_CHANGE', name: field, value, owner, confidence: hasSyntaxError ? 'inferred' : 'verified', evidence: ev }));
      }
      const conditionRegex = /\bif\s*\(([^\n)]{1,300})\)/g;
      for (const match of raw.matchAll(conditionRegex)) {
        if (match.index === undefined || !match[1]) continue;
        const ev = evFor(source, file, raw, match.index, className);
        const owner = methodOwnerAt(raw, match.index, className);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'condition', owner, match[1], ev.id), kind: 'CONDITION', name: 'if', value: match[1].trim(), owner, confidence: hasSyntaxError ? 'inferred' : 'verified', evidence: ev }));
      }
      const exceptionRegex = /\bthrow\s+new\s+(\w+)/g;
      for (const match of raw.matchAll(exceptionRegex)) {
        if (match.index === undefined || !match[1]) continue;
        const ev = evFor(source, file, raw, match.index, className);
        const owner = methodOwnerAt(raw, match.index, className);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'exception', owner, match[1], ev.id), kind: 'EXCEPTION', name: match[1], owner, confidence: hasSyntaxError ? 'inferred' : 'verified', evidence: ev }));
      }
      const validationRegex = /@(NotNull|NotBlank|NotEmpty|Size|Min|Max|Pattern)\b[^\n]*[\r\n]+\s*(?:private|public|protected)\s+[\w<>?,.]+\s+(\w+)/g;
      for (const match of raw.matchAll(validationRegex)) {
        if (match.index === undefined || !match[1] || !match[2]) continue;
        const ev = evFor(source, file, raw, match.index, `${className}.${match[2]}`);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'validation', className, match[2], ev.id), kind: 'VALIDATION', name: match[2], value: match[1], owner: className, confidence: 'verified', evidence: ev }));
      }
      const serviceCallRegex = /\b(\w+(?:Service|Mapper|Repository))\.(\w+)\s*\(/g;
      for (const match of raw.matchAll(serviceCallRegex)) {
        if (match.index === undefined || !match[1] || !match[2]) continue;
        const ev = evFor(source, file, raw, match.index, className);
        const kind = /(Mapper|Repository)$/.test(match[1]) ? 'DATA_ACCESS' : 'SERVICE_CALL';
        const owner = methodOwnerAt(raw, match.index, className);
        facts.push(codeFactSchema.parse({ id: stableId('fact', kind, owner, match[1], match[2], ev.id), kind, name: `${match[1]}.${match[2]}`, owner, target: match[1], confidence: 'verified', evidence: ev }));
      }
      const ranges = methodRanges(raw); const declaredMethods = new Set(ranges.map((range) => range.name));
      const localCalls: Array<{ caller: string; called: string; index: number }> = [];
      for (const range of ranges) {
        const body = raw.slice(range.open + 1, range.close);
        const localCallRegex = /(?<![.\w])(\w+)\s*\(/g;
        for (const match of body.matchAll(localCallRegex)) {
          if (match.index === undefined || !match[1] || match[1] === range.name || !declaredMethods.has(match[1])) continue;
          localCalls.push({ caller: range.name, called: match[1], index: range.open + 1 + match.index });
        }
      }
      const reachesData = new Set(facts.filter((fact) => fact.kind === 'DATA_ACCESS' && fact.owner?.startsWith(`${className}.`))
        .map((fact) => fact.owner?.slice(className.length + 1) ?? ''));
      let changed = true;
      while (changed) {
        changed = false;
        for (const call of localCalls) if (reachesData.has(call.called) && !reachesData.has(call.caller)) { reachesData.add(call.caller); changed = true; }
      }
      for (const call of localCalls.filter((item) => reachesData.has(item.called))) {
        const ev = evFor(source, file, raw, call.index, `${className}.${call.caller}`); const owner = `${className}.${call.caller}`;
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'local-call', owner, call.called, ev.id), kind: 'SERVICE_CALL', name: `${className}.${call.called}`, owner, target: className, confidence: 'verified', evidence: ev }));
      }
    }
    return sanitizeCodeFacts(facts);
  }
}
