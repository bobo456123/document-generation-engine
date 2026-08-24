import { describe, expect, it, vi } from 'vitest';
import { FeishuHierarchyResolver, FeishuHttpClient, FeishuPublisher, FeishuSdkClient, type FeishuApiClient, type FeishuSdkLike, type PublicationNodeMapping, toFeishuBlocks, toFeishuDescendants } from './index.js';
import { PublishError } from '@bizdoc/publisher';

describe('Feishu blocks', () => {
  it('creates and then reuses the system and module hierarchy', async () => {
    const remote = new Map<string, { node_token: string; obj_token: string; parent_node_token?: string; title: string }>();
    const request = vi.fn(async (method: string, route: string, body?: unknown) => {
      if (method === 'GET' && route.startsWith('/wiki/v2/spaces/get_node')) {
        const token = new URL(`https://test${route}`).searchParams.get('token') ?? '';
        return { data: { node: remote.get(token) } };
      }
      if (method === 'POST' && route.endsWith('/nodes')) {
        const value = body as { title: string; parent_node_token?: string };
        const index = remote.size + 1; const node = { node_token: `node-${index}`, obj_token: `doc-${index}`, ...(value.parent_node_token ? { parent_node_token: value.parent_node_token } : {}), title: value.title };
        remote.set(node.node_token, node); return { data: { node } };
      }
      return { data: {} };
    });
    const saved = new Map<string, PublicationNodeMapping>();
    const store = {
      publicationNodeMapping: (_targetId: string, localNodeId: string) => saved.get(localNodeId),
      savePublicationNodeMapping: (input: { localNodeId: string; nodeToken: string; documentToken: string; parentNodeToken?: string; title: string }) => saved.set(input.localNodeId, { nodeToken: input.nodeToken, documentToken: input.documentToken, title: input.title, ...(input.parentNodeToken ? { parentNodeToken: input.parentNodeToken } : {}) })
    };
    const client = { request, uploadImage: vi.fn() } as unknown as FeishuApiClient;
    const resolver = new FeishuHierarchyResolver(client, { id: 'feishu:space', spaceId: 'space' }, store);
    const classification = { system: { id: 'system:crm', name: '销售 CRM' }, module: { id: 'module:lead', name: '线索管理' } };
    await expect(resolver.ensurePath(classification)).resolves.toMatchObject({ displayPath: '销售 CRM/线索管理', module: { nodeToken: 'node-2' } });
    await resolver.ensurePath(classification);
    expect(request.mock.calls.filter(([method, route]) => method === 'POST' && String(route).endsWith('/nodes'))).toHaveLength(2);
    await resolver.ensurePath({ system: { ...classification.system, name: '客户关系系统' }, module: classification.module });
    expect(request).toHaveBeenCalledWith('POST', '/wiki/v2/spaces/space/nodes/node-1/update_title', { title: '客户关系系统' });
  });

  it('recovers unique unmapped hierarchy nodes without creating duplicates', async () => {
    const request = vi.fn(async (method: string, route: string) => {
      if (method === 'GET' && route.includes('/nodes?')) {
        const parent = new URL(`https://test${route}`).searchParams.get('parent_node_token');
        return parent
          ? { data: { items: [{ node_token: 'module-node', obj_token: 'module-doc', parent_node_token: 'system-node', title: '线索管理', obj_type: 'docx', node_type: 'origin' }] } }
          : { data: { items: [{ node_token: 'system-node', obj_token: 'system-doc', title: '销售 CRM', obj_type: 'docx', node_type: 'origin' }] } };
      }
      return { data: {} };
    });
    const saved = new Map<string, PublicationNodeMapping>();
    const store = {
      publicationNodeMapping: (_targetId: string, localNodeId: string) => saved.get(localNodeId),
      savePublicationNodeMapping: (input: { localNodeId: string; nodeToken: string; documentToken: string; parentNodeToken?: string; title: string }) => saved.set(input.localNodeId, { nodeToken: input.nodeToken, documentToken: input.documentToken, title: input.title, ...(input.parentNodeToken ? { parentNodeToken: input.parentNodeToken } : {}) })
    };
    const resolver = new FeishuHierarchyResolver({ request, uploadImage: vi.fn() } as unknown as FeishuApiClient, { id: 'feishu:space', spaceId: 'space' }, store);
    await expect(resolver.ensurePath({ system: { id: 'system:crm', name: '销售 CRM' }, module: { id: 'module:lead', name: '线索管理' } })).resolves.toMatchObject({ module: { nodeToken: 'module-node' } });
    expect(request.mock.calls.some(([method, route]) => method === 'POST' && String(route).endsWith('/nodes'))).toBe(false);
  });

  it('recovers a unique unmapped hierarchy node from a later page', async () => {
    const request = vi.fn(async (method: string, route: string) => {
      if (method !== 'GET' || !route.includes('/nodes?')) return { data: {} };
      const query = new URL(`https://test${route}`).searchParams;
      if (query.get('parent_node_token')) {
        return { data: { items: [{ node_token: 'module-node', obj_token: 'module-doc', parent_node_token: 'system-node', title: '线索管理', obj_type: 'docx', node_type: 'origin' }] } };
      }
      if (!query.get('page_token')) {
        return { data: { items: [{ node_token: 'other-node', obj_token: 'other-doc', title: '其他系统', obj_type: 'docx', node_type: 'origin' }], has_more: true, page_token: 'page-2' } };
      }
      return { data: { items: [{ node_token: 'system-node', obj_token: 'system-doc', title: '销售 CRM', obj_type: 'docx', node_type: 'origin' }], has_more: false } };
    });
    const saved = new Map<string, PublicationNodeMapping>();
    const store = {
      publicationNodeMapping: (_targetId: string, localNodeId: string) => saved.get(localNodeId),
      savePublicationNodeMapping: (input: { localNodeId: string; nodeToken: string; documentToken: string; parentNodeToken?: string; title: string }) => saved.set(input.localNodeId, { nodeToken: input.nodeToken, documentToken: input.documentToken, title: input.title, ...(input.parentNodeToken ? { parentNodeToken: input.parentNodeToken } : {}) })
    };
    const resolver = new FeishuHierarchyResolver({ request, uploadImage: vi.fn() } as unknown as FeishuApiClient, { id: 'feishu:space', spaceId: 'space' }, store);
    await expect(resolver.ensurePath({ system: { id: 'system:crm', name: '销售 CRM' }, module: { id: 'module:lead', name: '线索管理' } })).resolves.toMatchObject({ system: { nodeToken: 'system-node' }, module: { nodeToken: 'module-node' } });
    expect(request.mock.calls.some(([, route]) => String(route).includes('page_token=page-2'))).toBe(true);
    expect(request.mock.calls.some(([method, route]) => method === 'POST' && String(route).endsWith('/nodes'))).toBe(false);
  });

  it('blocks ambiguous hierarchy recovery instead of creating another node', async () => {
    const request = vi.fn(async (method: string, route: string) => method === 'GET' && route.includes('/nodes?')
      ? { data: { items: [
        { node_token: 'one', obj_token: 'doc-one', title: '销售 CRM', obj_type: 'docx', node_type: 'origin' },
        { node_token: 'two', obj_token: 'doc-two', title: '销售 CRM', obj_type: 'docx', node_type: 'origin' }
      ] } }
      : { data: {} });
    const store = { publicationNodeMapping: () => undefined, savePublicationNodeMapping: vi.fn() };
    const resolver = new FeishuHierarchyResolver({ request, uploadImage: vi.fn() } as unknown as FeishuApiClient, { id: 'feishu:space', spaceId: 'space' }, store);
    await expect(resolver.ensurePath({ system: { id: 'system:crm', name: '销售 CRM' }, module: { id: 'module:lead', name: '线索管理' } })).rejects.toMatchObject({ category: 'CONTENT' });
    expect(request.mock.calls.some(([method, route]) => method === 'POST' && String(route).endsWith('/nodes'))).toBe(false);
  });

  it('moves an existing document into its managed module before updating content', async () => {
    class ManagedClient extends FeishuHttpClient {
      readonly calls: Array<{ method: string; route: string; body?: unknown }> = [];
      override async request<T>(method: string, route: string, body?: unknown): Promise<T> {
        this.calls.push({ method, route, ...(body === undefined ? {} : { body }) });
        if (route.startsWith('/wiki/v2/spaces/get_node?token=document-node')) return { data: { node: { node_token: 'document-node', obj_token: 'document', parent_node_token: 'old-parent', title: 'Old Document' } } } as T;
        if (route.includes('/children') && method === 'GET') return { data: { items: [] } } as T;
        return { data: {} } as T;
      }
      override async uploadImage(): Promise<string> { return 'unused'; }
    }
    const client = new ManagedClient({ appId: 'test', appSecret: 'test' }, 'http://unused');
    const publisher = new FeishuPublisher(client, { id: 'target', spaceId: 'space', parentNodeToken: 'module-node', manageNodeLocation: true });
    await publisher.publish({ targetId: 'target', existing: { nodeToken: 'document-node', documentToken: 'document' }, document: { id: 'document:1', featureId: 'feature:1', title: 'Document', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1 } });
    expect(client.calls).toContainEqual(expect.objectContaining({ method: 'POST', route: '/wiki/v2/spaces/space/nodes/document-node/move', body: { target_parent_token: 'module-node' } }));
    expect(client.calls).toContainEqual(expect.objectContaining({ method: 'POST', route: '/wiki/v2/spaces/space/nodes/document-node/update_title', body: { title: 'Document' } }));
  });

  it('does not overwrite or duplicate an unmanaged document with the same title', async () => {
    const request = vi.fn(async (method: string, route: string) => method === 'GET' && route.includes('/nodes?')
      ? { data: { items: [{ node_token: 'manual-node', obj_token: 'manual-doc', parent_node_token: 'module-node', title: 'Document', obj_type: 'docx', node_type: 'origin' }] } }
      : { data: {} });
    const publisher = new FeishuPublisher({ request, uploadImage: vi.fn() } as unknown as FeishuApiClient, { id: 'target', spaceId: 'space', parentNodeToken: 'module-node' });
    await expect(publisher.publish({ targetId: 'target', document: { id: 'document:1', featureId: 'feature:1', title: 'Document', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1 } })).rejects.toMatchObject({ category: 'CONTENT' });
    expect(request.mock.calls.some(([method, route]) => method !== 'GET' && String(route).includes('/wiki/v2/spaces/space/nodes'))).toBe(false);
    expect(request.mock.calls.some(([, route]) => String(route).includes('/docx/v1/documents/manual-doc'))).toBe(false);
  });
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

  it('uses the official SDK client path and retries a temporary read failure', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary'), { response: { status: 503 } }))
      .mockResolvedValue({ code: 0, data: { ok: true } });
    const sdk = { request, drive: { media: { uploadAll: vi.fn() } } } as unknown as FeishuSdkLike;
    const wait = vi.fn(async () => undefined);
    const client = new FeishuSdkClient({ appId: 'test', appSecret: 'test' }, sdk, wait);
    await expect(client.request<{ data: { ok: boolean } }>('GET', '/wiki/v2/spaces/test')).resolves.toMatchObject({ data: { ok: true } });
    expect(request).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith({ method: 'GET', url: '/open-apis/wiki/v2/spaces/test' });
  });

  it('does not blindly retry a node-creation request after a temporary SDK failure', async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('temporary'), { response: { status: 503 } }));
    const sdk = { request, drive: { media: { uploadAll: vi.fn() } } } as unknown as FeishuSdkLike;
    const wait = vi.fn(async () => undefined);
    const client = new FeishuSdkClient({ appId: 'test', appSecret: 'test' }, sdk, wait);
    await expect(client.request('POST', '/wiki/v2/spaces/test/nodes', { title: 'test' })).rejects.toMatchObject({ category: 'REMOTE_API', retryable: true });
    expect(request).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });

  it('does not retry an index-based batch delete after a temporary SDK failure', async () => {
    const request = vi.fn().mockRejectedValueOnce(Object.assign(new Error('response lost after delete'), { response: { status: 503 } }));
    const sdk = { request, drive: { media: { uploadAll: vi.fn() } } } as unknown as FeishuSdkLike;
    const wait = vi.fn(async () => undefined);
    const client = new FeishuSdkClient({ appId: 'test', appSecret: 'test' }, sdk, wait);
    await expect(client.request('DELETE', '/docx/v1/documents/doc/blocks/doc/children/batch_delete', { start_index: 0, end_index: 2 }))
      .rejects.toMatchObject({ category: 'REMOTE_API', retryable: true });
    expect(request).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });

  it('does not retry an index-based batch delete after a temporary HTTP failure', async () => {
    const responses = [
      new Response(JSON.stringify({ code: 0, tenant_access_token: 'test-token', expire: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ code: 999, msg: 'response lost after delete' }), { status: 503, headers: { 'content-type': 'application/json' } })
    ];
    const fetcher = vi.fn(async () => responses.shift() ?? new Response()) as unknown as typeof fetch;
    const wait = vi.fn(async () => undefined);
    const client = new FeishuHttpClient({ appId: 'test', appSecret: 'test' }, 'http://unused', fetcher, wait);
    await expect(client.request('DELETE', '/docx/v1/documents/doc/blocks/doc/children/batch_delete', { start_index: 0, end_index: 2 }))
      .rejects.toMatchObject({ category: 'REMOTE_API', retryable: true, status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(wait).not.toHaveBeenCalled();
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
