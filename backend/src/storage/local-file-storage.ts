import { promises as fs } from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Shared by every upload path (part images, vehicle exterior photos) that stores a captured photo on disk. */
export function resolveImageExtension(mimetype: string): 'png' | 'jpg' {
  return mimetype === 'image/png' ? 'png' : 'jpg';
}

/** Inverse of resolveImageExtension -- used when serving a stored file back over HTTP, where only its extension (not the original mimetype) is known. */
export function mimetypeFromExtension(extension: string): string {
  return extension === 'png' ? 'image/png' : 'image/jpeg';
}

/**
 * Local-disk MVP file storage. A real deployment would swap this for
 * S3/GCS — flagged in docs/PROGRESS.md as a known scoping decision, not a
 * silently-cut corner. PartImage.url stores the relative path this returns,
 * so both the upload endpoint (write) and the AI worker (read) resolve
 * against the same configured root.
 */
@Injectable()
export class LocalFileStorage {
  constructor(private readonly config: ConfigService) {}

  private root(): string {
    return (
      this.config.get<string>('UPLOAD_DIR') ??
      path.resolve(process.cwd(), 'uploads')
    );
  }

  async save(relativePath: string, data: Buffer): Promise<string> {
    const fullPath = path.join(this.root(), relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
    return relativePath;
  }

  async read(relativePath: string): Promise<Buffer> {
    return fs.readFile(path.join(this.root(), relativePath));
  }

  async delete(relativePath: string): Promise<void> {
    await fs.rm(path.join(this.root(), relativePath), { force: true });
  }
}
