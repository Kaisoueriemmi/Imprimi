import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { StorageService } from './storage.service';

/** Storage kept in a Map, for tests. */
export class InMemoryStorageService extends StorageService {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async putFile(key: string, filePath: string, contentType: string): Promise<void> {
    this.objects.set(key, { body: await readFile(filePath), contentType });
  }

  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async getBuffer(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`NoSuchKey: ${key}`);
    return object.body;
  }

  async getStream(key: string): Promise<Readable> {
    return Readable.from(await this.getBuffer(key));
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key);
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    return `http://storage.test/${key}?ttl=${ttlSeconds}`;
  }

  async ping(): Promise<void> {}
}
