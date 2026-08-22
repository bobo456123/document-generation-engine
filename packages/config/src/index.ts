import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

export const projectConfigSchema = z.object({
  version: z.literal(1),
  project: z.object({ name: z.string().min(1) }),
  sources: z.object({
    frontend: z.object({ path: z.string().min(1), framework: z.enum(['auto', 'react', 'vue', 'umi']).default('auto') }),
    backend: z.object({ path: z.string().min(1), framework: z.literal('spring-boot') })
  }),
  analysis: z.object({
    include: z.array(z.string()).default(['src/**']), exclude: z.array(z.string()).default([]),
    mappings: z.array(z.object({
      frontend: z.object({ method: z.string(), path: z.string() }),
      backend: z.object({ method: z.string(), path: z.string() }),
      label: z.string().optional()
    })).default([])
  }).default({ include: ['src/**'], exclude: [], mappings: [] }),
  ai: z.object({ provider: z.enum(['openai', 'deepseek', 'qwen', 'anthropic', 'openai-compatible']), model: z.string().min(1), base_url: z.string().url().optional() }).optional(),
  publishing: z.object({
    feishu: z.object({ space_id: z.string().min(1), parent_node_token: z.string().optional() }).optional()
  }).optional()
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export async function loadProjectConfig(root: string): Promise<ProjectConfig> {
  const file = path.join(root, '.bizdoc', 'project.yaml');
  const parsed: unknown = YAML.parse(await readFile(file, 'utf8'));
  return projectConfigSchema.parse(parsed);
}

export const defaultProjectConfig = (name: string): ProjectConfig => ({
  version: 1,
  project: { name },
  sources: {
    frontend: { path: './frontend', framework: 'auto' },
    backend: { path: './backend', framework: 'spring-boot' }
  },
  analysis: { include: ['src/**'], exclude: ['**/generated/**'], mappings: [] }
});
