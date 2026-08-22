import { describe, expect, it } from 'vitest';
import { InMemoryPublisher } from './index.js';

const document = { id: 'document:1', featureId: 'feature:1', title: '创建商机', roles: [], scenarios: [], steps: [], fields: [], outcomes: [], notices: [], faqs: [], relatedFeatureIds: [], reviewItems: [], revision: 1 };
describe('Publisher contract', () => {
  it('is idempotent for the same target and document', async () => {
    const publisher = new InMemoryPublisher(); const first = await publisher.publish({ document, targetId: 'test' }); const second = await publisher.publish({ document, targetId: 'test' });
    expect(first.created).toBe(true); expect(second.created).toBe(false); expect(second.documentToken).toBe(first.documentToken); expect(publisher.size()).toBe(1);
  });
});
