import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Node, Project, ScriptKind, SyntaxKind } from 'ts-morph';
import { parse as parseVue } from '@vue/compiler-sfc';
import type { SourceInventory } from '@bizdoc/project-scanner';
import { codeFactSchema, sanitizeCodeFacts, stableId, type CodeFact, type Evidence } from '@bizdoc/business-model';

function lineAt(source: string, index: number): number { return source.slice(0, index).split('\n').length; }
function evidence(source: SourceInventory, file: string, text: string, index: number, symbol?: string): Evidence {
  const relative = path.relative(source.root, file);
  const line = lineAt(text, index);
  const lines = text.split('\n');
  const excerptStart = Math.max(0, line - 5);
  return {
    id: stableId('evidence', source.commit ?? '', relative, String(line), symbol), source: 'SOURCE_CODE', repository: source.root,
    ...(source.commit ? { commit: source.commit } : {}), file: relative, ...(symbol ? { symbol } : {}), startLine: line,
    excerpt: lines.slice(excerptStart, excerptStart + 14).join('\n').slice(0, 1000)
  };
}

function literalText(node: Node): string | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  return undefined;
}

function jsxActionText(element: Node): string | undefined {
  if (!Node.isJsxElement(element)) return undefined;
  const values: string[] = [];
  for (const child of element.getJsxChildren()) {
    if (Node.isJsxText(child)) { const value = child.getText().trim(); if (value) values.push(value); }
    if (Node.isJsxExpression(child)) {
      const expression = child.getExpression();
      if (expression && Node.isCallExpression(expression)) {
        const first = expression.getArguments()[0]; const value = first ? literalText(first) : undefined; if (value) values.push(value);
      }
    }
  }
  return values.join(' ').trim() || undefined;
}

export class FrontendAnalyzer {
  async analyze(source: SourceInventory): Promise<CodeFact[]> {
    const facts: CodeFact[] = [];
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, jsx: 2 } });
    const records: Array<{ file: string; raw: string; sourceFile: ReturnType<Project['createSourceFile']> }> = [];
    for (const file of source.files) {
      if (!/\.(?:[jt]sx?|vue)$/.test(file)) continue;
      const raw = await readFile(file, 'utf8');
      let script = raw;
      if (file.endsWith('.vue')) {
        const descriptor = parseVue(raw, { filename: file }).descriptor;
        script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';
      }
      const scriptKind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ScriptKind.TSX : ScriptKind.TS;
      const sf = project.createSourceFile(`${stableId('file', file)}.tsx`, script, { scriptKind, overwrite: true });
      records.push({ file, raw, sourceFile: sf });
      const hasPageMarkup = file.endsWith('.vue') ? /<template\b/.test(raw) : sf.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0;
      if (hasPageMarkup) {
        const name = path.basename(file).replace(/\.(?:[jt]sx?|vue)$/, ''); const index = file.endsWith('.vue') ? Math.max(0, raw.indexOf('<template')) : 0;
        const ev = evidence(source, file, raw, index, name);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'page', name, ev.id), kind: 'PAGE', name, confidence: 'verified', evidence: ev }));
      }
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (!Node.isCallExpression(call)) continue;
        const expression = call.getExpression().getText();
        const args = call.getArguments();
        const first = args[0] ? literalText(args[0]) : undefined;
        if (!first || !first.startsWith('/')) continue;
        const lower = expression.toLowerCase();
        const isHttpCall = /^(?:request|fetch)$/.test(lower) || /(?:^|\.)(?:get|post|put|patch|delete)$/.test(lower) && !/(?:history|router)\./.test(lower);
        const index = raw.indexOf(first); const ev = evidence(source, file, raw, Math.max(0, index), expression);
        if (!isHttpCall) {
          if (/^(?:navigate|history\.push|history\.replace|router\.push|router\.replace)$/.test(lower)) {
            facts.push(codeFactSchema.parse({ id: stableId('fact', 'navigation', first, ev.id), kind: 'NAVIGATION', name: expression, path: first, confidence: 'verified', evidence: ev }));
          }
          continue;
        }
        let method = 'GET';
        if (/\.(post|put|patch|delete)$/.test(lower)) method = lower.split('.').at(-1)?.toUpperCase() ?? 'GET';
        const options = args[1]?.getText() ?? '';
        const optionMethod = options.match(/method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i)?.[1];
        if (optionMethod) method = optionMethod.toUpperCase();
        const owner = call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)?.getName()
          ?? call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName()
          ?? call.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)?.getName();
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'api', method, first, ev.id), kind: 'API_CALL', name: expression, method, path: first, ...(owner ? { owner } : {}), confidence: 'verified', evidence: ev }));
      }
      const messageRegex = /\b(?:message|notification|toast)\.(success|error|warning|info)\s*\(\s*['"]([^'"]+)['"]/g;
      for (const match of raw.matchAll(messageRegex)) {
        if (match.index === undefined || !match[1] || !match[2]) continue;
        const ev = evidence(source, file, raw, match.index, match[1]);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'message', match[1], match[2], ev.id), kind: 'MESSAGE', name: match[1], value: match[2], confidence: 'verified', evidence: ev }));
      }
      const permissionRegex = /\b(?:hasPermission|canAccess|hasRole)\s*\(\s*['"]([^'"]+)['"]\s*\)|\bv-(?:permission|access)\s*=\s*['"]([^'"]+)['"]/g;
      for (const match of raw.matchAll(permissionRegex)) {
        if (match.index === undefined) continue; const value = match[1] ?? match[2]; if (!value) continue;
        const ev = evidence(source, file, raw, match.index, value);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'permission', value, ev.id), kind: 'PERMISSION', name: 'frontend-permission', value, confidence: 'verified', evidence: ev }));
      }
      const actionRegex = /<(?:Button|button)[^>]*>(?:\s*<[^>]+>)*\s*([^<{\n][^<{\n]{0,40})\s*(?:<\/[^>]+>\s*)*<\/(?:Button|button)>/g;
      for (const match of raw.matchAll(actionRegex)) {
        const name = match[1]?.trim(); if (!name || match.index === undefined) continue;
        const ev = evidence(source, file, raw, match.index, name);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'action', name, ev.id), kind: 'ACTION', name, confidence: 'verified', evidence: ev }));
      }
      for (const element of sf.getDescendantsOfKind(SyntaxKind.JsxElement)) {
        const tag = element.getOpeningElement().getTagNameNode().getText(); if (tag !== 'Button' && tag !== 'button') continue;
        const name = jsxActionText(element); if (!name) continue;
        const start = element.getStart(); const ev = evidence(source, file, raw, Math.min(start, raw.length - 1), name);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'action', name, ev.id), kind: 'ACTION', name, confidence: 'verified', evidence: ev }));
      }
      const routeRegex = /(?:path|pathname)\s*:\s*['"]([^'"]+)['"]/g;
      for (const match of raw.matchAll(routeRegex)) {
        if (!match[1] || match.index === undefined) continue;
        const ev = evidence(source, file, raw, match.index, match[1]);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'route', match[1], ev.id), kind: 'ROUTE', name: match[1], path: match[1], confidence: 'verified', evidence: ev }));
      }
      const requiredRegex = /name\s*=\s*[{]?['"]([^'"]+)['"][}]?[\s\S]{0,250}?required\s*:\s*true/g;
      for (const match of raw.matchAll(requiredRegex)) {
        if (!match[1] || match.index === undefined) continue;
        const ev = evidence(source, file, raw, match.index, match[1]);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'field', match[1], ev.id), kind: 'FORM_FIELD', name: match[1], value: 'required', confidence: 'verified', evidence: ev }));
      }
      const nativeRequiredRegex = /name\s*=\s*['"]([^'"]+)['"][^>]{0,250}\brequired\b/g;
      for (const match of raw.matchAll(nativeRequiredRegex)) {
        if (!match[1] || match.index === undefined) continue;
        const ev = evidence(source, file, raw, match.index, match[1]);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'field', match[1], ev.id), kind: 'FORM_FIELD', name: match[1], value: 'required', confidence: 'verified', evidence: ev }));
      }
      for (const statement of sf.getDescendantsOfKind(SyntaxKind.IfStatement)) {
        const expression = statement.getExpression();
        const value = expression.getText().slice(0, 500);
        const start = statement.getStart();
        const ev = evidence(source, file, raw, Math.min(start, raw.length - 1), value);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'condition', value, ev.id), kind: 'CONDITION', name: value, value, confidence: 'verified', evidence: ev }));
      }
      for (const declaration of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        const name = declaration.getName();
        const initializer = declaration.getInitializer();
        if (!initializer || !/^[A-Z][A-Z0-9_]+$/.test(name)) continue;
        const value = initializer.getText().slice(0, 500);
        const start = declaration.getStart();
        const ev = evidence(source, file, raw, Math.min(start, raw.length - 1), name);
        facts.push(codeFactSchema.parse({ id: stableId('fact', 'state', name, value, ev.id), kind: 'STATE_CHANGE', name, value, confidence: 'verified', evidence: ev }));
      }
    }
    const apiOwners = new Set(facts.filter((fact) => fact.kind === 'API_CALL' && fact.owner).map((fact) => fact.owner as string));
    for (const record of records) for (const call of record.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const target = call.getExpression().getText(); if (!apiOwners.has(target)) continue;
      const index = record.raw.indexOf(call.getText().slice(0, 80)); const ev = evidence(source, record.file, record.raw, Math.max(0, index), target);
      facts.push(codeFactSchema.parse({ id: stableId('fact', 'frontend-call', target, ev.id), kind: 'SERVICE_CALL', name: target, target, confidence: 'verified', evidence: ev }));
    }
    return sanitizeCodeFacts(facts);
  }
}
