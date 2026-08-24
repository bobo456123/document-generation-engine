#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await tsImport(pathToFileURL(path.join(repositoryRoot, 'apps/cli/src/main.ts')).href, {
  parentURL: import.meta.url,
  tsconfig: path.join(repositoryRoot, 'tsconfig.json')
});
