import console from 'node:console';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';

const WORK_ITEM_STATUSES = new Set(['proposed', 'ready', 'in_progress', 'blocked', 'done', 'cancelled']);
const ACTIVE_WORK_ITEM_STATUSES = new Set(['proposed', 'ready', 'in_progress', 'blocked']);
const COMPLETED_WORK_ITEM_STATUSES = new Set(['done', 'cancelled']);
const ADR_STATUSES = new Set(['proposed', 'accepted', 'superseded', 'rejected']);
const MILESTONE_STATUSES = new Set(['proposed', 'active', 'completed', 'cancelled']);
const REQUIRED_WORK_ITEM_FIELDS = ['id', 'title', 'status', 'milestone', 'created', 'updated', 'depends_on', 'related_adrs'];
const REQUIRED_WORK_ITEM_SECTIONS = ['结果', '背景', '范围', '约束', '实施方案', '验收标准', '证据', '交接说明'];
const REQUIRED_ADR_FIELDS = ['id', 'title', 'status', 'date', 'supersedes', 'related_work_items'];
const REQUIRED_MILESTONE_FIELDS = ['version', 'title', 'status', 'created', 'completed', 'acceptance'];
const REQUIRED_TOP_LEVEL_INDEXES = ['current', 'product', 'architecture', 'development', 'work-items', 'milestones', 'templates'];

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : extname(entry.name) === '.md' ? [path] : [];
  });
}

function parseFrontmatter(file, errors) {
  const content = readFileSync(file, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push(`${file}: missing YAML frontmatter`);
    return { metadata: {}, body: content };
  }

  try {
    const metadata = parseYaml(match[1]) ?? {};
    if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('frontmatter must be a mapping');
    return { metadata, body: content.slice(match[0].length) };
  } catch (error) {
    errors.push(`${file}: invalid YAML frontmatter (${error instanceof Error ? error.message : String(error)})`);
    return { metadata: {}, body: content.slice(match[0].length) };
  }
}

function requireFields(file, metadata, fields, errors) {
  for (const field of fields) {
    if (!(field in metadata)) errors.push(`${file}: missing frontmatter field '${field}'`);
  }
}

function collectLinkTargets(tokens, targets = []) {
  if (!tokens || typeof tokens !== 'object') return targets;
  if (Array.isArray(tokens)) {
    for (const token of tokens) collectLinkTargets(token, targets);
    return targets;
  }
  if ((tokens.type === 'link' || tokens.type === 'image') && typeof tokens.href === 'string') targets.push(tokens.href);
  for (const [key, value] of Object.entries(tokens)) {
    if (key !== 'href') collectLinkTargets(value, targets);
  }
  return targets;
}

function localTarget(href) {
  if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href)) return null;
  const withoutFragment = href.split('#', 1)[0].split('?', 1)[0];
  if (!withoutFragment) return null;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

function validateLinks(repoRoot, files, errors) {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    let targets;
    try {
      targets = collectLinkTargets(marked.lexer(content));
    } catch (error) {
      errors.push(`${file}: Markdown parse failed (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    for (const href of targets) {
      const target = localTarget(href);
      if (target === null) continue;
      if (isAbsolute(target)) {
        errors.push(`${file}: local link must be relative (${href})`);
        continue;
      }
      const destination = resolve(dirname(file), target);
      const outsideRepo = relative(repoRoot, destination).split(sep)[0] === '..';
      if (outsideRepo || !existsSync(destination)) errors.push(`${file}: broken internal link (${href})`);
    }
  }
}

function validateWorkItems(docsRoot, errors) {
  const records = [];
  const ids = new Map();
  for (const directoryName of ['active', 'completed']) {
    const directory = resolve(docsRoot, 'work-items', directoryName);
    for (const file of markdownFiles(directory).filter((candidate) => !candidate.endsWith(`${sep}README.md`))) {
      const { metadata, body } = parseFrontmatter(file, errors);
      requireFields(file, metadata, REQUIRED_WORK_ITEM_FIELDS, errors);
      if (typeof metadata.id !== 'string' || !/^WI-\d{4}$/.test(metadata.id)) errors.push(`${file}: invalid work item id`);
      if (!WORK_ITEM_STATUSES.has(metadata.status)) errors.push(`${file}: invalid work item status '${String(metadata.status)}'`);
      const allowed = directoryName === 'active' ? ACTIVE_WORK_ITEM_STATUSES : COMPLETED_WORK_ITEM_STATUSES;
      if (!allowed.has(metadata.status)) errors.push(`${file}: status '${String(metadata.status)}' does not belong in ${directoryName}/`);
      if (typeof metadata.id === 'string' && !file.split(sep).at(-1)?.startsWith(`${metadata.id}-`)) errors.push(`${file}: filename must start with '${metadata.id}-'`);
      for (const field of ['depends_on', 'related_adrs']) {
        if (field in metadata && !Array.isArray(metadata[field])) errors.push(`${file}: '${field}' must be an array`);
      }
      for (const section of REQUIRED_WORK_ITEM_SECTIONS) {
        if (!new RegExp(`^##\\s+${section}\\s*$`, 'm').test(body)) errors.push(`${file}: missing required section '${section}'`);
      }
      if (typeof metadata.id === 'string') {
        if (ids.has(metadata.id)) errors.push(`${file}: duplicate work item id '${metadata.id}' (also in ${ids.get(metadata.id)})`);
        else ids.set(metadata.id, file);
      }
      records.push({ file, directoryName, metadata });
    }
  }
  return records;
}

function validateAdrs(docsRoot, errors) {
  const ids = new Map();
  const directory = resolve(docsRoot, 'architecture', 'decisions');
  for (const file of markdownFiles(directory).filter((candidate) => !candidate.endsWith(`${sep}README.md`))) {
    const { metadata } = parseFrontmatter(file, errors);
    requireFields(file, metadata, REQUIRED_ADR_FIELDS, errors);
    if (typeof metadata.id !== 'string' || !/^ADR-\d{4}$/.test(metadata.id)) errors.push(`${file}: invalid ADR id`);
    if (!ADR_STATUSES.has(metadata.status)) errors.push(`${file}: invalid ADR status '${String(metadata.status)}'`);
    if (typeof metadata.id === 'string' && !file.split(sep).at(-1)?.startsWith(`${metadata.id}-`)) errors.push(`${file}: filename must start with '${metadata.id}-'`);
    for (const field of ['supersedes', 'related_work_items']) {
      if (field in metadata && !Array.isArray(metadata[field])) errors.push(`${file}: '${field}' must be an array`);
    }
    if (typeof metadata.id === 'string') {
      if (ids.has(metadata.id)) errors.push(`${file}: duplicate ADR id '${metadata.id}' (also in ${ids.get(metadata.id)})`);
      else ids.set(metadata.id, file);
    }
  }
}

function validateMilestones(docsRoot, errors) {
  const directory = resolve(docsRoot, 'milestones');
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true }).filter((candidate) => candidate.isDirectory())) {
    const file = resolve(directory, entry.name, 'README.md');
    if (!existsSync(file)) {
      errors.push(`${resolve(directory, entry.name)}: milestone is missing README.md`);
      continue;
    }
    const { metadata } = parseFrontmatter(file, errors);
    requireFields(file, metadata, REQUIRED_MILESTONE_FIELDS, errors);
    if (!MILESTONE_STATUSES.has(metadata.status)) errors.push(`${file}: invalid milestone status '${String(metadata.status)}'`);
  }
}

function readCurrentMetadata(docsRoot, name, expectedDocument, errors) {
  const file = resolve(docsRoot, 'current', name);
  if (!existsSync(file)) {
    errors.push(`${file}: required current document is missing`);
    return {};
  }
  const { metadata } = parseFrontmatter(file, errors);
  requireFields(file, metadata, ['document', 'updated', 'current_milestone', 'active_work_items'], errors);
  if (metadata.document !== expectedDocument) errors.push(`${file}: document must be '${expectedDocument}'`);
  if (!Array.isArray(metadata.active_work_items)) errors.push(`${file}: 'active_work_items' must be an array`);
  return metadata;
}

function validateCurrentState(docsRoot, workItems, errors) {
  const status = readCurrentMetadata(docsRoot, 'STATUS.md', 'current-status', errors);
  const handoff = readCurrentMetadata(docsRoot, 'HANDOFF.md', 'current-handoff', errors);
  const handoffDocuments = markdownFiles(docsRoot).filter((file) => {
    const content = readFileSync(file, 'utf8');
    return /^---\r?\n[\s\S]*?\bdocument:\s*current-handoff\s*$/m.test(content.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0] ?? '');
  });
  if (handoffDocuments.length !== 1 || handoffDocuments[0] !== resolve(docsRoot, 'current', 'HANDOFF.md')) {
    errors.push(`${docsRoot}: exactly one canonical current handoff is required at current/HANDOFF.md`);
  }

  const statusIds = Array.isArray(status.active_work_items) ? [...status.active_work_items].sort() : [];
  const handoffIds = Array.isArray(handoff.active_work_items) ? [...handoff.active_work_items].sort() : [];
  if (JSON.stringify(statusIds) !== JSON.stringify(handoffIds)) errors.push(`${docsRoot}: STATUS.md and HANDOFF.md active_work_items differ`);
  const activeIds = workItems.filter((item) => item.directoryName === 'active').map((item) => item.metadata.id).filter((id) => typeof id === 'string').sort();
  if (JSON.stringify(statusIds) !== JSON.stringify(activeIds)) errors.push(`${docsRoot}: active work item files are not fully registered in current status and handoff`);
}

function validateDocsIndex(docsRoot, errors) {
  const index = resolve(docsRoot, 'README.md');
  if (!existsSync(index)) {
    errors.push(`${index}: documentation index is missing`);
    return;
  }
  const hrefs = collectLinkTargets(marked.lexer(readFileSync(index, 'utf8')))
    .map(localTarget)
    .filter((target) => target !== null)
    .map((target) => resolve(dirname(index), target));
  for (const area of REQUIRED_TOP_LEVEL_INDEXES) {
    const areaRoot = resolve(docsRoot, area);
    if (!hrefs.some((target) => target === areaRoot || target.startsWith(`${areaRoot}${sep}`))) errors.push(`${index}: top-level area '${area}/' is not indexed`);
  }
  if (!hrefs.includes(resolve(docsRoot, 'CHANGELOG.md'))) errors.push(`${index}: CHANGELOG.md is not indexed`);
}

export function checkDocs({ rootDir = process.cwd() } = {}) {
  const repoRoot = resolve(rootDir);
  const docsRoot = resolve(repoRoot, 'docs');
  const errors = [];
  if (!existsSync(docsRoot) || !statSync(docsRoot).isDirectory()) return [`${docsRoot}: docs directory is missing`];

  const requiredRootDocuments = [resolve(repoRoot, 'README.md'), resolve(repoRoot, 'AGENTS.md')];
  for (const file of requiredRootDocuments) {
    if (!existsSync(file)) errors.push(`${file}: required root document is missing`);
  }
  const linkedMarkdown = [...requiredRootDocuments, ...markdownFiles(docsRoot)].filter(existsSync);
  validateLinks(repoRoot, linkedMarkdown, errors);
  const workItems = validateWorkItems(docsRoot, errors);
  validateAdrs(docsRoot, errors);
  validateMilestones(docsRoot, errors);
  validateCurrentState(docsRoot, workItems, errors);
  validateDocsIndex(docsRoot, errors);
  return errors;
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const errors = checkDocs();
  if (errors.length > 0) {
    console.error(`Documentation check failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error.replace(`${resolve(process.cwd())}${sep}`, '')}`);
    process.exitCode = 1;
  } else {
    console.log('Documentation check passed.');
  }
}
