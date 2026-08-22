import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('core model dependency boundaries', () => {
  it('keeps business and document models independent from frameworks and adapters', async () => {
    const files = [path.resolve('packages/business-model/src/index.ts'), path.resolve('packages/document-model/src/index.ts')];
    const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    for (const forbidden of ['@nestjs/', 'drizzle-orm', 'better-sqlite3', '@larksuiteoapi/']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
