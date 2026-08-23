import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDocs } from './check-docs.mjs';

const workItem = ({ id = 'WI-0001', status = 'in_progress', includeTitle = true } = {}) => `---
id: ${id}
${includeTitle ? 'title: Test work item\n' : ''}status: ${status}
milestone: v0.2
created: 2026-08-23
updated: 2026-08-23
depends_on: []
related_adrs: []
---

# ${id} Test

## 结果
Result
## 背景
Context
## 范围
Scope
## 约束
Constraints
## 实施方案
Implementation
## 验收标准
Acceptance
## 证据
Evidence
## 交接说明
Handoff
`;

const fixtureRoots = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root, path, content) {
  const destination = resolve(root, path);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  writeFileSync(destination, content);
}

function fixture({ statusIds = ['WI-0001'], handoffIds = statusIds, workItems = [{ path: 'active/WI-0001-test.md', content: workItem() }], indexLink = './current/STATUS.md' } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'bizdoc-docs-'));
  fixtureRoots.push(root);
  write(root, 'README.md', '# Root\n\n[Docs](./docs/README.md)\n');
  write(root, 'AGENTS.md', '# Agents\n\n[Docs](./docs/README.md)\n');
  write(root, 'docs/README.md', `# Docs

[Current](${indexLink})
[Product](./product/README.md)
[Architecture](./architecture/README.md)
[Development](./development/README.md)
[Work items](./work-items/README.md)
[Milestones](./milestones/v0.2/README.md)
[Templates](./templates/README.md)
[Changelog](./CHANGELOG.md)
`);
  for (const path of ['product/README.md', 'architecture/README.md', 'development/README.md', 'work-items/README.md', 'work-items/active/README.md', 'work-items/completed/README.md', 'templates/README.md', 'CHANGELOG.md']) write(root, `docs/${path}`, `# ${path}\n`);
  write(root, 'docs/current/STATUS.md', `---
document: current-status
updated: 2026-08-23
current_milestone: v0.2
active_work_items: [${statusIds.join(', ')}]
---
# Status
`);
  write(root, 'docs/current/HANDOFF.md', `---
document: current-handoff
updated: 2026-08-23
current_milestone: v0.2
active_work_items: [${handoffIds.join(', ')}]
---
# Handoff
`);
  write(root, 'docs/milestones/v0.2/README.md', `---
version: v0.2
title: Test
status: active
created: 2026-08-23
completed: null
acceptance: pending
---
# Milestone
`);
  for (const item of workItems) write(root, `docs/work-items/${item.path}`, item.content);
  return root;
}

describe('documentation checker', () => {
  it('accepts a structurally valid documentation tree', () => {
    expect(checkDocs({ rootDir: fixture() })).toEqual([]);
  });

  it('rejects a broken internal link', () => {
    const errors = checkDocs({ rootDir: fixture({ indexLink: './current/MISSING.md' }) });
    expect(errors.some((error) => error.includes('broken internal link'))).toBe(true);
  });

  it('rejects duplicate work item ids', () => {
    const errors = checkDocs({ rootDir: fixture({
      workItems: [
        { path: 'active/WI-0001-first.md', content: workItem() },
        { path: 'active/WI-0001-second.md', content: workItem() }
      ]
    }) });
    expect(errors.some((error) => error.includes('duplicate work item id'))).toBe(true);
  });

  it('rejects invalid status and missing metadata', () => {
    const errors = checkDocs({ rootDir: fixture({
      workItems: [{ path: 'active/WI-0001-test.md', content: workItem({ status: 'unknown', includeTitle: false }) }]
    }) });
    expect(errors.some((error) => error.includes("missing frontmatter field 'title'"))).toBe(true);
    expect(errors.some((error) => error.includes('invalid work item status'))).toBe(true);
  });

  it('rejects active work items missing from current status and handoff', () => {
    const errors = checkDocs({ rootDir: fixture({ statusIds: [], handoffIds: [] }) });
    expect(errors.some((error) => error.includes('not fully registered'))).toBe(true);
  });
});
