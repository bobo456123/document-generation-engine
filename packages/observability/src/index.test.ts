import { describe, expect, it } from 'vitest';
import { createLogger } from './index.js';

describe('logger', () => {
  it('configures redaction without exposing a credential', () => {
    const output: string[] = [];
    const logger = createLogger({ write: (line: string) => { output.push(line); } });
    logger.info({ token: 'plain-token', credentials: { appSecret: 'plain-secret' }, headers: { authorization: 'Bearer plain-auth' } }, 'redaction-check');
    const rendered = output.join('');
    expect(rendered).toContain('[REDACTED]');
    expect(rendered).not.toContain('plain-token');
    expect(rendered).not.toContain('plain-secret');
    expect(rendered).not.toContain('plain-auth');
  });
});
