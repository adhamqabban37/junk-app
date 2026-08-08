import { promises as fs } from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  /**
   * Deletes a stored file. A file that is already gone is not an error:
   * writes here and rows in Postgres are not in one transaction, so the two
   * can legitimately disagree, and failing a vehicle deletion because one
   * photo had already vanished from disk would leave the caller permanently
   * unable to finish. Anything else (a permission problem, a bad path) still
   * throws -- silently swallowing those would hide a real storage fault.
   */
  async remove(relativePath: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.root(), relativePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
