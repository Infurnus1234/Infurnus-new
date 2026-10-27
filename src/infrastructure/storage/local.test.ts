import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorageProvider } from './local.js';
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
describe('private loopback document storage', () => {
  it('persists bytes, rejects unsigned/tampered URLs, and removes deleted files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'infurnus-local-docs-'));
    folders.push(folder);
    const provider = new LocalStorageProvider(folder, 'http://127.0.0.1:3110', 'test-signing-key');
    const app = express();
    provider.attach(app);
    const bytes = Buffer.from('CLEARLY LABELLED SYNTHETIC TEST DOCUMENT');
    const saved = await provider.upload({
      file: {
        buffer: bytes,
        mimeType: 'image/png',
        originalFileName: 'TEST.png',
        fileSize: bytes.length,
      },
      folder: 'ignored',
      resourceType: 'image',
      accessMode: 'authenticated',
    });
    expect(saved.storageProvider).toBe('local');
    const url = new URL(await provider.getAccessUrl(saved));
    const response = await request(app)
      .get(url.pathname + url.search)
      .expect(200);
    expect(response.body).toEqual(bytes);
    expect(response.headers['cache-control']).toBe('no-store');
    await request(app).get(url.pathname).expect(403);
    await request(app)
      .get(url.pathname + url.search.replace('signature=', 'signature=0'))
      .expect(403);
    await request(app)
      .get(url.pathname + '?expires=1&signature=' + '0'.repeat(64))
      .expect(403);
    await provider.delete(saved);
    await request(app)
      .get(url.pathname + url.search)
      .expect(404);
    await expect(provider.getAccessUrl({ ...saved, storageKey: '../outside' })).rejects.toThrow();
  });
  it('refuses a remote origin', () => {
    expect(() => new LocalStorageProvider('.', 'http://192.168.1.2:3110', 'key')).toThrow(
      'loopback',
    );
  });
});
