import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import type { DocumentationModel } from '@bizdoc/document-model';

export interface ScreenshotAsset { id: string; hash: string; mimeType: string; path: string; width: number; height: number; size: number }
const mimeByType: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export class ScreenshotManager {
  async import(root: string, file: string): Promise<ScreenshotAsset> {
    const buffer = await readFile(file); if (buffer.length > 10 * 1024 * 1024) throw new Error('Screenshot exceeds 10 MB');
    const dimensions = imageSize(buffer); const type = dimensions.type?.toLowerCase(); const mimeType = type ? mimeByType[type] : undefined;
    if (!mimeType || !dimensions.width || !dimensions.height) throw new Error('Only valid PNG, JPEG, and WebP screenshots are supported');
    if (dimensions.width > 12_000 || dimensions.height > 12_000 || dimensions.width * dimensions.height > 50_000_000) throw new Error('Screenshot dimensions exceed the supported limit');
    const hash = createHash('sha256').update(buffer).digest('hex'); const extension = type === 'jpg' ? 'jpeg' : type;
    const targetDir = path.join(root, '.bizdoc', 'assets'); await mkdir(targetDir, { recursive: true });
    const target = path.join(targetDir, `${hash}.${extension}`); await copyFile(file, target);
    return { id: `asset:${randomUUID()}`, hash, mimeType, path: target, width: dimensions.width, height: dimensions.height, size: buffer.length };
  }

  attach(document: DocumentationModel, sectionId: string, assetId: string, alt: string): DocumentationModel {
    const steps = document.steps.map((step) => step.id === sectionId ? { ...step, screenshots: [...step.screenshots, { assetId, alt }] } : step);
    if (!steps.some((step) => step.screenshots.some((shot) => shot.assetId === assetId))) throw new Error(`Document section not found: ${sectionId}`);
    return { ...document, steps };
  }
}
