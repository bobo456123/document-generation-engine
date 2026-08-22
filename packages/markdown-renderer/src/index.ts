import type { DocumentationModel } from '@bizdoc/document-model';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';

const escapeCell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
export class MarkdownRenderer {
  render(document: DocumentationModel, assetPaths: Record<string, string> = {}): string {
    const lines: string[] = [`# ${document.title}`, ''];
    if (document.sourceSnapshotId) lines.push(`> 来源快照：\`${document.sourceSnapshotId}\``, '');
    lines.push('## 功能简介', '', document.summary?.text ?? '待补充', '', '## 使用角色', '');
    lines.push(...(document.roles.length ? document.roles.map((item) => `- ${item.text}`) : ['待确认']), '', '## 使用场景', '');
    lines.push(...(document.scenarios.length ? document.scenarios.map((item) => `- ${item.text}`) : ['待确认']), '', '## 操作步骤', '');
    document.steps.forEach((step, index) => {
      lines.push(`${index + 1}. **${step.title}**：${step.instruction.text}`, '');
      for (const screenshot of step.screenshots) lines.push(`   ![${screenshot.alt}](${assetPaths[screenshot.assetId] ?? screenshot.assetId})`, '');
    });
    lines.push('## 字段说明', '', '| 字段 | 是否必填 | 说明 |', '|---|---|---|');
    if (document.fields.length) for (const field of document.fields) lines.push(`| ${escapeCell(field.name)} | ${field.required === true ? '是' : field.required === false ? '否' : '待确认'} | ${escapeCell(field.description.text)} |`);
    else lines.push('| - | - | 暂无明确字段证据 |');
    lines.push('', '## 操作结果', '', ...(document.outcomes.length ? document.outcomes.map((item) => `- ${item.text}`) : ['待确认']), '', '## 注意事项', '', ...(document.notices.length ? document.notices.map((item) => `- ${item.text}`) : ['待确认']), '', '## 常见问题', '');
    if (document.faqs.length) document.faqs.forEach((faq) => lines.push(`### ${faq.question}`, '', faq.answer.text, '')); else lines.push('暂无。', '');
    lines.push('## 相关功能', '', ...(document.relatedFeatureIds.length ? document.relatedFeatureIds.map((id) => `- ${id}`) : ['暂无。']), '');
    const evidenceIds = [...new Set([
      ...(document.summary?.evidenceIds ?? []), ...document.roles.flatMap((item) => item.evidenceIds),
      ...document.scenarios.flatMap((item) => item.evidenceIds), ...document.steps.flatMap((step) => step.instruction.evidenceIds),
      ...document.fields.flatMap((field) => field.description.evidenceIds), ...document.outcomes.flatMap((item) => item.evidenceIds),
      ...document.notices.flatMap((item) => item.evidenceIds), ...document.faqs.flatMap((item) => item.answer.evidenceIds)
    ])];
    lines.push('## 证据索引', '', ...(evidenceIds.length ? evidenceIds.map((id) => `- \`${id}\``) : ['暂无代码证据。']), '');
    lines.push('## 待审核项', '', ...(document.reviewItems.length
      ? document.reviewItems.map((item) => `- [${item.severity}] ${item.message}（章节：\`${item.sectionId}\`）`)
      : ['无。']), '');
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  }
}

export async function startLocalPreview(markdownPath: string, port = 4173): Promise<{ server: Server; url: string }> {
  const markdown = await readFile(markdownPath, 'utf8');
  let body = await marked.parse(markdown);
  const imageSources = [...body.matchAll(/<img\s+[^>]*src="([^"]+)"/g)].map((match) => match[1]).filter((source): source is string => typeof source === 'string' && !/^(?:https?:|data:)/.test(source));
  for (const source of imageSources) {
    const imagePath = path.resolve(path.dirname(markdownPath), decodeURIComponent(source));
    const buffer = await readFile(imagePath); const extension = path.extname(imagePath).slice(1).toLowerCase();
    const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';
    body = body.replaceAll(`src="${source}"`, `src="data:${mime};base64,${buffer.toString('base64')}"`);
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bizdoc Preview</title><style>body{font:16px/1.7 system-ui;margin:40px auto;max-width:900px;padding:0 24px;color:#202124}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}img{max-width:100%;height:auto}code{background:#f3f4f6;padding:2px 4px}</style></head><body>${body}</body></html>`;
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${port}` };
}
