import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@bizdoc\/(.+)$/,
        replacement: fileURLToPath(new URL('./packages/$1/src/index.ts', import.meta.url))
      }
    ]
  },
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'scripts/**/*.test.mjs'],
    coverage: { reporter: ['text', 'json-summary'] }
  }
});
