import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import type { StorageProviderAdapter } from './storage.js';
import type { StorageUploadInput, StorageAccessUrlInput, StorageDeleteInput } from './types.js';

/** Private disk storage for explicitly configured loopback development only. */
export class LocalStorageProvider implements StorageProviderAdapter {
  constructor(
    private root: string,
    private origin: string,
    private secret: string,
  ) {
    this.root = resolve(root);
    if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
      throw Error('Local storage requires a loopback origin');
  }
  private valid(id: string) {
    return /^[a-f0-9-]{36}$/.test(id);
  }
  private path(id: string, suffix: string) {
    if (!this.valid(id)) throw Error('Invalid local storage key');
    return resolve(this.root, id + suffix);
  }
  private sign(id: string, expires: string) {
    return createHmac('sha256', this.secret)
      .update(id + ':' + expires)
      .digest('hex');
  }
  async upload(input: StorageUploadInput) {
    const id = randomUUID();
    await mkdir(this.root, { recursive: true });
    await writeFile(this.path(id, '.bin'), input.file.buffer);
    await writeFile(this.path(id, '.json'), JSON.stringify({ mimeType: input.file.mimeType }));
    return {
      storageProvider: 'local' as const,
      storageKey: id,
      resourceType: input.resourceType,
      accessMode: input.accessMode,
      mimeType: input.file.mimeType,
      fileSize: input.file.fileSize,
    };
  }
  async delete(input: StorageDeleteInput) {
    await unlink(this.path(input.storageKey, '.bin'));
    await unlink(this.path(input.storageKey, '.json'));
  }
  async getAccessUrl(input: StorageAccessUrlInput) {
    if (!this.valid(input.storageKey)) throw Error('Invalid local storage key');
    const expires = String(
      Math.floor(Date.now() / 1000) + Math.min(Math.max(input.options?.expiresIn ?? 300, 1), 300),
    );
    return `${this.origin}/__local_documents/${input.storageKey}?expires=${expires}&signature=${this.sign(input.storageKey, expires)}`;
  }
  attach(app: Express) {
    app.get('/__local_documents/:id', async (req, res) => {
      const id = String(req.params.id),
        expires = String(req.query.expires ?? ''),
        signature = String(req.query.signature ?? '');
      if (
        !this.valid(id) ||
        !/^\d+$/.test(expires) ||
        Number(expires) < Date.now() / 1000 ||
        Number(expires) > Date.now() / 1000 + 301 ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(this.sign(id, expires), 'hex'))
      ) {
        res.sendStatus(403);
        return;
      }
      try {
        const meta = JSON.parse(await readFile(this.path(id, '.json'), 'utf8'));
        res
          .set('Cache-Control', 'no-store')
          .set('X-Content-Type-Options', 'nosniff')
          .type(meta.mimeType)
          .send(await readFile(this.path(id, '.bin')));
      } catch {
        res.sendStatus(404);
      }
    });
  }
}
