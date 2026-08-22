import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer, startLocalPreview } from './index.js';

describe('MarkdownRenderer', () => {
  it('renders evidence-backed sections and escapes table cells', () => {
    const markdown = new MarkdownRenderer().render({
      id: 'document:1', featureId: 'feature:1', title: '创建商机', summary: { text: '创建新的商机。', evidenceIds: ['e'], confidence: 'verified' },
      roles: [], scenarios: [], steps: [{ id: 'step:1', title: '提交', instruction: { text: '点击提交。', evidenceIds: ['e'], confidence: 'verified' }, screenshots: [{ assetId: 'asset:1', alt: '提交页面' }] }],
      fields: [{ name: 'name|项目名', required: true, description: { text: '必填', evidenceIds: ['e'], confidence: 'verified' } }], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1
    }, { 'asset:1': '../assets/shot.png' });
    expect(markdown).toContain('| name\\|项目名 | 是 | 必填 |');
    expect(markdown).toContain('![提交页面](../assets/shot.png)');
    expect(markdown).toContain('## 证据索引');
    expect(markdown).toContain('`e`');
    expect(markdown).toContain('## 待审核项');
  });

  it('embeds relative screenshots and binds only to localhost', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bizdoc-preview-'));
    try {
      await writeFile(path.join(root, 'screen.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
      const markdown = path.join(root, 'document.md'); await writeFile(markdown, '# Preview\n\n![screen](screen.png)\n');
      const preview = await startLocalPreview(markdown, 0); const address = preview.server.address();
      if (!address || typeof address === 'string') throw new Error('preview address unavailable');
      const response = await fetch(`http://127.0.0.1:${address.port}`); const html = await response.text();
      expect(html).toContain('src="data:image/png;base64,'); expect(address.address).toBe('127.0.0.1');
      const port = address.port;
      await new Promise<void>((resolve, reject) => preview.server.close((error) => error ? reject(error) : resolve()));
      const reopened = await startLocalPreview(markdown, port);
      await new Promise<void>((resolve, reject) => reopened.server.close((error) => error ? reject(error) : resolve()));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
