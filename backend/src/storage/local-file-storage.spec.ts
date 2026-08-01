import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { LocalFileStorage } from './local-file-storage';

describe('LocalFileStorage', () => {
  let root: string;
  let storage: LocalFileStorage;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'junkyard-storage-test-'));
    storage = new LocalFileStorage(new ConfigService({ UPLOAD_DIR: root }));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('saves a file under the configured root and reads it back byte-for-byte', async () => {
    const data = Buffer.from('fake-jpeg-bytes');
    const relativePath = await storage.save('tenant-1/image-1.jpg', data);

    expect(relativePath).toBe('tenant-1/image-1.jpg');
    const read = await storage.read(relativePath);
    expect(read.equals(data)).toBe(true);
  });

  it('creates nested directories as needed', async () => {
    await storage.save('tenant-1/parts/part-1/photo.jpg', Buffer.from('x'));
    const stat = await fs.stat(
      path.join(root, 'tenant-1', 'parts', 'part-1', 'photo.jpg'),
    );
    expect(stat.isFile()).toBe(true);
  });
});
