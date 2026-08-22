import type { DocumentationModel } from '@bizdoc/document-model';
import { PublishError, type PublishInput, type Publisher, type PublishResult } from '@bizdoc/publisher';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as lark from '@larksuiteoapi/node-sdk';

export interface FeishuCredentials { appId: string; appSecret: string }
export interface FeishuTarget { id: string; spaceId: string; parentNodeToken?: string }
export interface FeishuApiClient { request<T>(method: string, route: string, body?: unknown): Promise<T>; uploadImage(documentToken: string, filePath: string, mimeType?: string): Promise<string> }
export interface FeishuBlock { block_type: number; text?: { elements: Array<{ text_run: { content: string } }> }; heading1?: { elements: Array<{ text_run: { content: string } }> }; heading2?: { elements: Array<{ text_run: { content: string } }> }; bullet?: { elements: Array<{ text_run: { content: string } }> }; ordered?: { elements: Array<{ text_run: { content: string } }> }; image?: { token: string }; table?: { property: { row_size: number; column_size: number; column_width?: number[]; header_row?: boolean } }; tableRows?: string[][] }
export interface FeishuDescendant extends Omit<FeishuBlock, 'tableRows'> { block_id: string; children?: string[] }

export function toFeishuBlocks(document: DocumentationModel, imageTokens: Record<string, string> = {}): FeishuBlock[] {
  const text = (content: string): Array<{ text_run: { content: string } }> => [{ text_run: { content } }];
  const blocks: FeishuBlock[] = [{ block_type: 3, heading1: { elements: text(document.title) } }];
  const section = (title: string, values: string[]): void => {
    blocks.push({ block_type: 4, heading2: { elements: text(title) } });
    if (!values.length) blocks.push({ block_type: 2, text: { elements: text('待确认') } });
    else values.forEach((value) => blocks.push({ block_type: 12, bullet: { elements: text(value) } }));
  };
  section('功能简介', document.summary ? [document.summary.text] : []);
  section('使用角色', document.roles.map((item) => item.text));
  section('使用场景', document.scenarios.map((item) => item.text));
  blocks.push({ block_type: 4, heading2: { elements: text('操作步骤') } });
  document.steps.forEach((step) => {
    blocks.push({ block_type: 13, ordered: { elements: text(`${step.title}：${step.instruction.text}`) } });
    step.screenshots.forEach((screenshot) => {
      const token = imageTokens[screenshot.assetId];
      if (token) blocks.push({ block_type: 27, image: { token } });
    });
  });
  blocks.push({ block_type: 4, heading2: { elements: text('字段说明') } });
  if (document.fields.length) {
    const rows = [['字段', '是否必填', '说明'], ...document.fields.map((field) => [field.name, field.required === true ? '是' : field.required === false ? '否' : '待确认', field.description.text])];
    blocks.push({ block_type: 31, table: { property: { row_size: rows.length, column_size: 3, column_width: [180, 100, 360], header_row: true } }, tableRows: rows });
  } else blocks.push({ block_type: 2, text: { elements: text('暂无明确字段证据') } });
  section('操作结果', document.outcomes.map((item) => item.text)); section('注意事项', document.notices.map((item) => item.text));
  section('常见问题', document.faqs.map((item) => `${item.question}：${item.answer.text}`));
  return blocks;
}

export function toFeishuDescendants(blocks: FeishuBlock[], offset = 0): { children_id: string[]; descendants: FeishuDescendant[]; index: number } {
  const children_id: string[] = []; const descendants: FeishuDescendant[] = [];
  blocks.forEach((block, blockIndex) => {
    const blockId = `local-${offset + blockIndex}`; children_id.push(blockId);
    const { tableRows, ...content } = block;
    if (!tableRows) { descendants.push({ ...content, block_id: blockId }); return; }
    const cellIds = tableRows.flatMap((row, rowIndex) => row.map((_cell, columnIndex) => `${blockId}-cell-${rowIndex}-${columnIndex}`));
    descendants.push({ ...content, block_id: blockId, children: cellIds });
    tableRows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
      const cellId = `${blockId}-cell-${rowIndex}-${columnIndex}`; const textId = `${cellId}-text`;
      descendants.push({ block_id: cellId, block_type: 32, children: [textId] });
      descendants.push({ block_id: textId, block_type: 2, text: { elements: [{ text_run: { content: cell } }] } });
    }));
  });
  return { children_id, descendants, index: offset };
}

export class FeishuHttpClient {
  constructor(
    private readonly credentials: FeishuCredentials,
    private readonly baseUrl = 'https://open.feishu.cn/open-apis',
    private readonly fetcher: typeof fetch = fetch,
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {}
  private token?: { value: string; expiresAt: number };

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const response = await this.fetcher(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: this.credentials.appId, app_secret: this.credentials.appSecret }) });
    const data = await response.json() as { code: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (!response.ok || data.code !== 0 || !data.tenant_access_token) throw new PublishError(`Feishu authentication failed: ${data.msg ?? response.status}`, 'AUTHORIZATION', false, response.status);
    this.token = { value: data.tenant_access_token, expiresAt: Date.now() + (data.expire ?? 3600) * 1000 }; return this.token.value;
  }

  async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const token = await this.accessToken(); let lastError: PublishError | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetcher(`${this.baseUrl}${route}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const data = await response.json() as { code?: number; msg?: string } & T;
        if (response.ok && (data.code === undefined || data.code === 0)) return data;
        const retryable = response.status === 429 || response.status >= 500;
        const category = response.status === 401 || response.status === 403 ? 'AUTHORIZATION' : response.status === 429 ? 'RATE_LIMIT' : response.status === 400 || response.status === 422 ? 'CONTENT' : 'REMOTE_API';
        lastError = new PublishError(`Feishu request failed (${response.status}): ${data.msg ?? 'unknown error'}`, category, retryable, response.status);
        if (!retryable) break;
        const retryAfter = Number(response.headers.get('retry-after'));
        await this.wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt);
      } catch (error) {
        if (error instanceof PublishError) throw error;
        lastError = new PublishError(`Feishu network request failed: ${error instanceof Error ? error.message : String(error)}`, 'NETWORK', true);
        if (attempt < 2) await this.wait(250 * 2 ** attempt);
      }
    }
    throw lastError ?? new PublishError('Feishu request failed', 'REMOTE_API', false);
  }

  async uploadImage(documentToken: string, filePath: string, mimeType = 'application/octet-stream'): Promise<string> {
    const token = await this.accessToken(); const buffer = await readFile(filePath); let lastError: PublishError | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const form = new FormData();
      form.set('file_name', path.basename(filePath)); form.set('parent_type', 'docx_image'); form.set('parent_node', documentToken); form.set('size', String(buffer.length));
      form.set('file', new Blob([buffer], { type: mimeType }), path.basename(filePath));
      try {
        const response = await this.fetcher(`${this.baseUrl}/drive/v1/medias/upload_all`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
        const data = await response.json() as { code: number; msg?: string; data?: { file_token?: string } };
        const fileToken = data.data?.file_token;
        if (response.ok && data.code === 0 && fileToken) return fileToken;
        const retryable = response.status === 429 || response.status >= 500;
        const category = response.status === 401 || response.status === 403 ? 'AUTHORIZATION' : response.status === 429 ? 'RATE_LIMIT' : response.status >= 500 ? 'REMOTE_API' : 'CONTENT';
        lastError = new PublishError(`Feishu image upload failed: ${data.msg ?? response.status}`, category, retryable, response.status);
        if (!retryable) break;
        await this.wait(250 * 2 ** attempt);
      } catch (error) {
        if (error instanceof PublishError) throw error;
        lastError = new PublishError(`Feishu image upload failed: ${error instanceof Error ? error.message : String(error)}`, 'NETWORK', true);
        if (attempt < 2) await this.wait(250 * 2 ** attempt);
      }
    }
    throw lastError ?? new PublishError('Feishu image upload failed', 'REMOTE_API', false);
  }
}

export interface FeishuSdkLike {
  request<T>(payload: { method: string; url: string; data?: unknown }): Promise<T>;
  drive: { media: { uploadAll(payload: { data: { file_name: string; parent_type: 'docx_image'; parent_node: string; size: number; file: Buffer } }): Promise<{ file_token?: string } | null> } };
}

function sdkErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined;
  const response = error.response;
  if (!response || typeof response !== 'object' || !('status' in response)) return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}

function sdkErrorDetail(error: unknown): string {
  if (!error || typeof error !== 'object' || !('response' in error)) return error instanceof Error ? error.message : String(error);
  const response = error.response;
  if (!response || typeof response !== 'object' || !('data' in response)) return error instanceof Error ? error.message : String(error);
  const data = response.data;
  if (data && typeof data === 'object') {
    const code = 'code' in data ? String(data.code) : undefined;
    const message = 'msg' in data ? String(data.msg) : 'message' in data ? String(data.message) : undefined;
    if (code || message) return [code, message].filter(Boolean).join(': ');
  }
  return typeof data === 'string' ? data : error instanceof Error ? error.message : String(error);
}

export class FeishuSdkClient implements FeishuApiClient {
  private readonly sdk: FeishuSdkLike;
  constructor(credentials: FeishuCredentials, sdk?: FeishuSdkLike, private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) {
    this.sdk = sdk ?? new lark.Client({ appId: credentials.appId, appSecret: credentials.appSecret, appType: lark.AppType.SelfBuild, domain: lark.Domain.Feishu }) as unknown as FeishuSdkLike;
  }

  async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    let lastError: PublishError | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const url = route.startsWith('/open-apis/') ? route : `/open-apis${route}`;
        const result = await this.sdk.request<T & { code?: number; msg?: string }>({ method, url, ...(body === undefined ? {} : { data: body }) });
        if (result.code === undefined || result.code === 0) return result;
        lastError = new PublishError(`Feishu SDK request failed: ${result.msg ?? result.code}`, 'REMOTE_API', false);
        break;
      } catch (error) {
        const status = sdkErrorStatus(error); const retryable = status === 429 || status === undefined || status >= 500;
        const category = status === 401 || status === 403 ? 'AUTHORIZATION' : status === 429 ? 'RATE_LIMIT' : status === undefined ? 'NETWORK' : status === 400 || status === 422 ? 'CONTENT' : 'REMOTE_API';
        lastError = new PublishError(`Feishu SDK request failed${status ? ` (${status})` : ''}: ${sdkErrorDetail(error)}`, category, retryable, status);
        if (!retryable) break;
        if (attempt < 2) await this.wait(250 * 2 ** attempt);
      }
    }
    throw lastError ?? new PublishError('Feishu SDK request failed', 'REMOTE_API', false);
  }

  async uploadImage(documentToken: string, filePath: string): Promise<string> {
    const buffer = await readFile(filePath); let lastError: PublishError | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.sdk.drive.media.uploadAll({ data: { file_name: path.basename(filePath), parent_type: 'docx_image', parent_node: documentToken, size: buffer.length, file: buffer } });
        if (result?.file_token) return result.file_token;
        lastError = new PublishError('Feishu SDK image upload returned no file token', 'REMOTE_API', false); break;
      } catch (error) {
        const status = sdkErrorStatus(error); const retryable = status === 429 || status === undefined || status >= 500;
        const category = status === 401 || status === 403 ? 'AUTHORIZATION' : status === 429 ? 'RATE_LIMIT' : status === undefined ? 'NETWORK' : status >= 500 ? 'REMOTE_API' : 'CONTENT';
        lastError = new PublishError(`Feishu SDK image upload failed${status ? ` (${status})` : ''}: ${error instanceof Error ? error.message : String(error)}`, category, retryable, status);
        if (!retryable) break;
        if (attempt < 2) await this.wait(250 * 2 ** attempt);
      }
    }
    throw lastError ?? new PublishError('Feishu SDK image upload failed', 'REMOTE_API', false);
  }
}

export class FeishuPublisher implements Publisher {
  constructor(private readonly client: FeishuApiClient, private readonly target: FeishuTarget) {}
  async publish(input: PublishInput): Promise<PublishResult> {
    await this.client.request('GET', `/wiki/v2/spaces/${this.target.spaceId}`);
    if (this.target.parentNodeToken) await this.client.request('GET', `/wiki/v2/spaces/get_node?token=${encodeURIComponent(this.target.parentNodeToken)}`);
    let documentToken = input.existing?.documentToken;
    let nodeToken = input.existing?.nodeToken;
    let created = false;
    if (!documentToken) {
      const node = await this.client.request<{ data?: { node?: { node_token?: string; obj_token?: string } } }>('POST', `/wiki/v2/spaces/${this.target.spaceId}/nodes`, { obj_type: 'docx', ...(this.target.parentNodeToken ? { parent_node_token: this.target.parentNodeToken } : {}), node_type: 'origin', title: input.document.title });
      nodeToken = node.data?.node?.node_token; documentToken = node.data?.node?.obj_token; created = true;
    }
    if (!nodeToken || !documentToken) throw new PublishError('Incomplete Feishu publication mapping', 'REMOTE_API', false);
    try {
      if (!created) {
        const children = await this.client.request<{ data?: { items?: unknown[] } }>('GET', `/docx/v1/documents/${documentToken}/blocks/${documentToken}/children?page_size=500`);
        const count = children.data?.items?.length ?? 0;
        if (count > 0) await this.client.request('DELETE', `/docx/v1/documents/${documentToken}/blocks/${documentToken}/children/batch_delete`, { start_index: 0, end_index: count });
      }
      const imageTokens: Record<string, string> = {};
      for (const step of input.document.steps) for (const screenshot of step.screenshots) {
        const asset = input.assets?.[screenshot.assetId];
        if (!asset) throw new PublishError(`Screenshot asset is missing: ${screenshot.assetId}`, 'CONTENT', false);
        imageTokens[screenshot.assetId] = await this.client.uploadImage(documentToken, asset.path, asset.mimeType);
      }
      const blocks = toFeishuBlocks(input.document, imageTokens);
      for (let index = 0; index < blocks.length; index += 50) {
        await this.client.request('POST', `/docx/v1/documents/${documentToken}/blocks/${documentToken}/descendant`, toFeishuDescendants(blocks.slice(index, index + 50), index));
      }
      return { nodeToken, documentToken, created, url: `https://feishu.cn/docx/${documentToken}` };
    } catch (error) {
      const publishError = error instanceof PublishError ? error : new PublishError(error instanceof Error ? error.message : String(error), 'REMOTE_API', false);
      publishError.nodeToken = nodeToken; publishError.documentToken = documentToken;
      throw publishError;
    }
  }
}
