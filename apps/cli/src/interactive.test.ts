import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { askText, chooseOne, type PromptIO } from './interactive.js';

function io(input: string, interactive = true): PromptIO & { outputText: () => string } {
  const source = new PassThrough(); source.end(input);
  const output = new PassThrough(); let text = ''; output.on('data', (chunk) => { text += String(chunk); });
  return { input: source, output, interactive, outputText: () => text };
}

describe('CLI choices', () => {
  it('selects the only choice without prompting', async () => {
    await expect(chooseOne('document', [{ value: 'one', label: 'One' }], io('', false))).resolves.toBe('one');
  });

  it('uses a numeric terminal selection', async () => {
    await expect(chooseOne('feature', [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }], io('2\n'))).resolves.toBe('two');
  });

  it('does not prompt for ambiguous choices outside a terminal', async () => {
    await expect(chooseOne('feature', [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }], io('', false))).rejects.toThrow('explicit ID');
  });

  it('does not echo secret input', async () => {
    const prompt = io('fixture-secret\n');
    await expect(askText('Secret', { secret: true, io: prompt })).resolves.toBe('fixture-secret');
    expect(prompt.outputText()).not.toContain('fixture-secret');
  });

  it('uses a caller-provided non-interactive instruction', async () => {
    await expect(askText('Secret', { io: io('', false), unavailableMessage: 'Use the environment variable.' })).rejects.toThrow('Use the environment variable.');
  });
});
