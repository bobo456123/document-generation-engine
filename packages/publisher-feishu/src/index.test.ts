import { describe, expect, it, vi } from 'vitest';
import { FeishuHttpClient, FeishuPublisher, FeishuSdkClient, type FeishuSdkLike, toFeishuBlocks, toFeishuDescendants } from './index.js';
import { PublishError } from '@bizdoc/publisher';

describe('Feishu blocks', () => {
  it('silences the official SDK logger so request metadata cannot reach console logs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      new FeishuSdkClient({ appId: 'test', appSecret: 'test' });
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore(); error.mockRestore();
    }
  });

  it('converts the platform-neutral model without Markdown parsing', () => {
    const blocks = toFeishuBlocks({ id: 'document:1', featureId: 'feature:1', title: '创建商机', summary: { text: '简介', evidenceIds: ['e'], confidence: 'verified' }, roles: [], scenarios: [], steps: [{ id: 's', title: '提交', instruction: { text: '点击提交', evidenceIds: ['e'], confidence: 'verified' }, screenshots: [{ assetId: 'asset:1', alt: '提交页' }] }], fields: [{ name: 'name', required: true, description: { text: '商机名称', evidenceIds: ['e'], confidence: 'verified' } }], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1 }, { 'asset:1': 'image-token' });
    expect(blocks.some((block) => block.heading1)).toBe(false);
    expect(blocks.some((block) => block.ordered?.elements[0]?.text_run.content.includes('点击提交'))).toBe(true);
    expect(blocks.some((block) => block.image?.token === 'image-token')).toBe(true);
    expect(blocks.some((block) => block.block_type === 31 && block.table?.property.column_size === 3)).toBe(true);
    const nested = toFeishuDescendants(blocks);
    expect(nested.descendants.some((block) => block.block_type === 32 && block.table_cell && Object.keys(block.table_cell).length === 0)).toBe(true);
    expect(JSON.stringify(nested)).toContain('商机名称');
  });

  it('replaces existing children and uploads referenced images', async () => {
    class FakeClient extends FeishuHttpClient {
      readonly calls: Array<{ method: string; route: string; body?: unknown }> = [];
      override async request<T>(method: string, route: string, body?: unknown): Promise<T> {
        this.calls.push({ method, route, ...(body === undefined ? {} : { body }) });
        if (method === 'GET') return { data: { items: [{}, {}] } } as T;
        if (method === 'POST' && route.endsWith('/children')) return { data: { children: [{ block_id: 'image-block' }] } } as T;
        return {} as T;
      }
      override async uploadImage(parentNode: string): Promise<string> { this.calls.push({ method: 'UPLOAD', route: parentNode }); return 'uploaded-image'; }
    }
    const client = new FakeClient({ appId: 'test', appSecret: 'test' }, 'http://unused');
    const publisher = new FeishuPublisher(client, { id: 'target', spaceId: 'space' });
    const result = await publisher.publish({
      targetId: 'target', existing: { nodeToken: 'node', documentToken: 'doc' }, assets: { 'asset:1': { id: 'asset:1', path: process.execPath, mimeType: 'image/png' } },
      document: { id: 'document:1', featureId: 'feature:1', title: '创建商机', roles: [], scenarios: [], steps: [{ id: 's', title: '提交', instruction: { text: '点击提交', evidenceIds: ['e'], confidence: 'verified' }, screenshots: [{ assetId: 'asset:1', alt: '提交页' }] }], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 2 }
    });
    expect(result.created).toBe(false);
    expect(client.calls.map((call) => call.method)).toEqual(['GET', 'GET', 'POST', 'POST', 'POST', 'UPLOAD', 'PATCH', 'DELETE']);
    expect(client.calls[2]?.body).not.toHaveProperty('index');
    expect(client.calls[3]?.route).toContain('/children');
    expect(client.calls[5]?.route).toBe('image-block');
    expect(client.calls[6]?.body).toEqual({ replace_image: { token: 'uploaded-image' } });
    expect(client.calls[7]?.body).toEqual({ start_index: 0, end_index: 2 });
  });

  it('keeps existing children when image upload fails', async () => {
    class FailingUploadClient extends FeishuHttpClient {
      readonly calls: Array<{ method: string; route: string }> = [];
      override async request<T>(method: string, route: string): Promise<T> {
        this.calls.push({ method, route });
        if (method === 'POST' && route.endsWith('/children')) return { data: { children: [{ block_id: 'image-block' }] } } as T;
        if (method === 'POST') return {} as T;
        return { data: { items: [{}, {}] } } as T;
      }
      override async uploadImage(): Promise<string> { throw new PublishError('media forbidden', 'AUTHORIZATION', false, 403); }
    }
    const client = new FailingUploadClient({ appId: 'test', appSecret: 'test' }, 'http://unused');
    const publisher = new FeishuPublisher(client, { id: 'target', spaceId: 'space' });
    await expect(publisher.publish({
      targetId: 'target', existing: { nodeToken: 'node', documentToken: 'doc' }, assets: { 'asset:1': { id: 'asset:1', path: process.execPath, mimeType: 'image/png' } },
      document: { id: 'document:1', featureId: 'feature:1', title: 'Document', roles: [], scenarios: [], steps: [{ id: 's', title: 'Step', instruction: { text: 'Do it', evidenceIds: [], confidence: 'inferred' }, screenshots: [{ assetId: 'asset:1', alt: 'Screenshot' }] }], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 2 }
    })).rejects.toMatchObject({ category: 'AUTHORIZATION' });
    expect(client.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('keeps existing children when writing replacement blocks fails', async () => {
    class FailingWriteClient extends FeishuHttpClient {
      readonly calls: Array<{ method: string; route: string }> = [];
      override async request<T>(method: string, route: string): Promise<T> {
        this.calls.push({ method, route });
        if (method === 'POST' && route.includes('/descendant')) throw new PublishError('write failed', 'REMOTE_API', true, 503);
        return { data: { items: [{}, {}] } } as T;
      }
      override async uploadImage(): Promise<string> { return 'uploaded-image'; }
    }
    const client = new FailingWriteClient({ appId: 'test', appSecret: 'test' }, 'http://unused');
    const publisher = new FeishuPublisher(client, { id: 'target', spaceId: 'space' });
    await expect(publisher.publish({
      targetId: 'target', existing: { nodeToken: 'node', documentToken: 'doc' },
      document: { id: 'document:1', featureId: 'feature:1', title: 'Document', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 2 }
    })).rejects.toMatchObject({ category: 'REMOTE_API' });
    expect(client.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('rejects missing screenshot assets before modifying the remote document', async () => {
    const client = { request: vi.fn(), uploadImage: vi.fn() };
    const publisher = new FeishuPublisher(client, { id: 'target', spaceId: 'space' });
    const document = {
      id: 'document:missing-image', featureId: 'feature:1', title: 'Document', roles: [], scenarios: [],
      steps: [{ id: 'step:1', title: 'Step', instruction: { text: 'Do it', evidenceIds: [], confidence: 'inferred' as const }, screenshots: [{ assetId: 'asset:missing', alt: 'Missing' }] }],
      fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1
    };
    await expect(publisher.publish({ document, targetId: 'target', existing: { nodeToken: 'node', documentToken: 'doc' } }))
      .rejects.toMatchObject({ category: 'CONTENT', retryable: false });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('retries 429 responses with a bound delay and exposes a categorized final error', async () => {
    const responses = [
      new Response(JSON.stringify({ code: 0, tenant_access_token: 'test-token', expire: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      ...Array.from({ length: 3 }, () => new Response(JSON.stringify({ code: 999, msg: 'limited' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } }))
    ];
    const fetcher = vi.fn(async () => responses.shift() ?? new Response()) as unknown as typeof fetch;
    const wait = vi.fn(async () => undefined);
    const client = new FeishuHttpClient({ appId: 'test', appSecret: 'test' }, 'http://unused', fetcher, wait);
    const request = client.request('GET', '/test');
    await expect(request).rejects.toMatchObject({ category: 'RATE_LIMIT', retryable: true, status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(4); expect(wait).toHaveBeenCalledTimes(3);
  });

  it('does not retry authorization failures', async () => {
    const responses = [
      new Response(JSON.stringify({ code: 0, tenant_access_token: 'test-token', expire: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ code: 999, msg: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } })
    ];
    const fetcher = vi.fn(async () => responses.shift() ?? new Response()) as unknown as typeof fetch;
    const client = new FeishuHttpClient({ appId: 'test', appSecret: 'test' }, 'http://unused', fetcher, vi.fn(async () => undefined));
    await expect(client.request('GET', '/test')).rejects.toEqual(expect.objectContaining<Partial<PublishError>>({ category: 'AUTHORIZATION', retryable: false, status: 403 }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses the official SDK client path and retries a temporary SDK failure', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary'), { response: { status: 503 } }))
      .mockResolvedValue({ code: 0, data: { ok: true } });
    const sdk = { request, drive: { media: { uploadAll: vi.fn() } } } as unknown as FeishuSdkLike;
    const wait = vi.fn(async () => undefined);
    const client = new FeishuSdkClient({ appId: 'test', appSecret: 'test' }, sdk, wait);
    await expect(client.request<{ data: { ok: boolean } }>('POST', '/wiki/v2/spaces/test/nodes', { title: 'test' })).resolves.toMatchObject({ data: { ok: true } });
    expect(request).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith({ method: 'POST', url: '/open-apis/wiki/v2/spaces/test/nodes', data: { title: 'test' } });
  });

  it('preserves the Feishu business error returned by the SDK', async () => {
    const sdk = { request: vi.fn().mockRejectedValue(Object.assign(new Error('bad request'), { response: { status: 400, data: { code: 1770001, msg: 'invalid block' } } })), drive: { media: { uploadAll: vi.fn() } } } as unknown as FeishuSdkLike;
    const client = new FeishuSdkClient({ appId: 'test', appSecret: 'test' }, sdk);
    await expect(client.request('POST', '/docx/v1/documents/doc/blocks/doc/descendant', {}))
      .rejects.toThrow('1770001: invalid block');
  });

  it('does not expose raw SDK request metadata from image upload errors', async () => {
    const unsafe = Object.assign(new Error('Authorization: Bearer fixture-upload-token'), { response: { status: 403, data: { code: 99991663, msg: 'forbidden' } } });
    const sdk = { request: vi.fn(), drive: { media: { uploadAll: vi.fn().mockRejectedValue(unsafe) } } } as unknown as FeishuSdkLike;
    const client = new FeishuSdkClient({ appId: 'test', appSecret: 'test' }, sdk);
    const promise = client.uploadImage('document', process.execPath);
    await expect(promise).rejects.toThrow('99991663: forbidden');
    await expect(promise).rejects.not.toThrow('fixture-upload-token');
    expect(sdk.drive.media.uploadAll).toHaveBeenCalledTimes(1);
  });

  it('categorizes Feishu 400 missing-scope responses as authorization failures', async () => {
    const denied = Object.assign(new Error('bad request'), { response: { status: 400, data: { code: 99991672, msg: 'Access denied. Required scope is missing.' } } });
    const sdk = { request: vi.fn(), drive: { media: { uploadAll: vi.fn().mockRejectedValue(denied) } } } as unknown as FeishuSdkLike;
    const client = new FeishuSdkClient({ appId: 'test', appSecret: 'test' }, sdk);
    await expect(client.uploadImage('document', process.execPath)).rejects.toMatchObject({ category: 'AUTHORIZATION', retryable: false, status: 400 });
  });
});
