import { createHash } from 'node:crypto';
import { z } from 'zod';

export const docContentSchema = z.object({ text: z.string(), evidenceIds: z.array(z.string()), confidence: z.enum(['verified', 'inferred', 'confirmed']) }).superRefine((content, context) => {
  if (content.confidence !== 'inferred' && content.evidenceIds.length === 0) context.addIssue({ code: 'custom', path: ['evidenceIds'], message: `${content.confidence} content requires evidence` });
});
export const screenshotRefSchema = z.object({ assetId: z.string(), alt: z.string() });
export const operationStepSchema = z.object({ id: z.string(), title: z.string(), instruction: docContentSchema, screenshots: z.array(screenshotRefSchema) });
export const reviewItemSchema = z.object({ id: z.string(), sectionId: z.string(), message: z.string(), severity: z.enum(['info', 'warning', 'blocking']) });
export const documentationModelSchema = z.object({
  id: z.string(), featureId: z.string(), title: z.string(),
  sourceSnapshotId: z.string().optional(), sourceCommits: z.record(z.string(), z.string().nullable()).optional(),
  summary: docContentSchema.optional(), roles: z.array(docContentSchema), scenarios: z.array(docContentSchema), steps: z.array(operationStepSchema),
  fields: z.array(z.object({ name: z.string(), required: z.boolean().optional(), description: docContentSchema })),
  outcomes: z.array(docContentSchema), notices: z.array(docContentSchema),
  faqs: z.array(z.object({ question: z.string(), answer: docContentSchema })), relatedFeatureIds: z.array(z.string()),
  reviewItems: z.array(reviewItemSchema), revision: z.number().int().positive()
});
export type DocumentationModel = z.infer<typeof documentationModelSchema>;
export type DocContent = z.infer<typeof docContentSchema>;

export function documentId(featureId: string): string {
  return `document:${createHash('sha256').update(featureId).digest('hex').slice(0, 16)}`;
}
