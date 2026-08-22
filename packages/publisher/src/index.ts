import type { DocumentationModel } from '@bizdoc/document-model';

export interface PublishAsset { id: string; path: string; mimeType?: string }
export interface PublishInput { document: DocumentationModel; targetId: string; assets?: Record<string, PublishAsset>; existing?: { nodeToken?: string; documentToken?: string } }
export interface PublishResult { nodeToken: string; documentToken: string; url?: string; created: boolean }
export interface Publisher { publish(input: PublishInput): Promise<PublishResult> }

export type PublishErrorCategory = 'CONFIGURATION' | 'AUTHORIZATION' | 'RATE_LIMIT' | 'NETWORK' | 'CONTENT' | 'REMOTE_API';
export class PublishError extends Error {
  nodeToken?: string;
  documentToken?: string;
  constructor(message: string, readonly category: PublishErrorCategory, readonly retryable: boolean, readonly status?: number) {
    super(message);
    this.name = 'PublishError';
  }
}

export class InMemoryPublisher implements Publisher {
  private readonly records = new Map<string, PublishResult>();
  async publish(input: PublishInput): Promise<PublishResult> {
    const key = `${input.targetId}:${input.document.id}`; const existing = this.records.get(key);
    if (existing) return { ...existing, created: false };
    const result = { nodeToken: `node-${input.document.id}`, documentToken: `doc-${input.document.id}`, created: true };
    this.records.set(key, result); return result;
  }
  size(): number { return this.records.size; }
}
