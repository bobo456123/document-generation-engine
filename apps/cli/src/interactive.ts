import { createInterface } from 'node:readline/promises';
import { Writable, type Readable } from 'node:stream';
import process from 'node:process';

export interface PromptIO {
  input: Readable;
  output: NodeJS.WritableStream;
  interactive: boolean;
}

export interface Choice<T> { value: T; label: string; detail?: string }

export const terminalPromptIO = (): PromptIO => ({ input: process.stdin, output: process.stderr, interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY) });

export async function askText(message: string, options: { defaultValue?: string; secret?: boolean; io?: PromptIO; unavailableMessage?: string } = {}): Promise<string> {
  const io = options.io ?? terminalPromptIO();
  if (!io.interactive) throw new Error(options.unavailableMessage ?? `Interactive input is unavailable. Provide ${message} through an explicit option.`);
  const suffix = options.defaultValue ? ` (${options.defaultValue})` : '';
  io.output.write(`${message}${suffix}: `);
  let muted = Boolean(options.secret);
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) io.output.write(chunk, encoding as BufferEncoding);
      callback();
    }
  });
  const readline = createInterface({ input: io.input, output, terminal: true });
  try {
    const answer = (await readline.question('')).trim();
    muted = false;
    if (options.secret) io.output.write('\n');
    return answer || options.defaultValue || '';
  } finally {
    readline.close();
  }
}

export async function chooseOne<T>(message: string, choices: Choice<T>[], io: PromptIO = terminalPromptIO()): Promise<T> {
  if (choices.length === 0) throw new Error(`No choices available for ${message}`);
  if (choices.length === 1) return choices[0]!.value;
  if (!io.interactive) throw new Error(`${message} has multiple choices. Provide an explicit ID in non-interactive mode.`);
  io.output.write(`${message}:\n`);
  choices.forEach((choice, index) => io.output.write(`  ${index + 1}. ${choice.label}${choice.detail ? ` - ${choice.detail}` : ''}\n`));
  const answer = await askText('请选择序号', { defaultValue: '1', io });
  const selected = Number(answer);
  if (!Number.isInteger(selected) || selected < 1 || selected > choices.length) throw new Error(`Invalid selection: ${answer}`);
  return choices[selected - 1]!.value;
}

export async function confirm(message: string, defaultValue = false, io: PromptIO = terminalPromptIO()): Promise<boolean> {
  if (!io.interactive) return defaultValue;
  const answer = (await askText(`${message} [${defaultValue ? 'Y/n' : 'y/N'}]`, { io })).toLowerCase();
  if (!answer) return defaultValue;
  return answer === 'y' || answer === 'yes';
}
