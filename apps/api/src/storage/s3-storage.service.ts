import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { AppConfigService } from '../config/env';
import { StorageService } from './storage.service';

@Injectable()
export class S3StorageService extends StorageService implements OnModuleDestroy {
  private readonly client: S3Client;
  /** Signs URLs with the public endpoint; never used to send requests. */
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ConfigService) env: AppConfigService) {
    super();
    this.bucket = env.get('S3_BUCKET', { infer: true });
    const base: S3ClientConfig = {
      region: env.get('S3_REGION', { infer: true }),
      forcePathStyle: env.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: env.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: env.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
      // Only send checksums when the operation requires them: several S3-compatible stores
      // (R2, older MinIO, Garage) reject the newer default checksum headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    const endpoint = env.get('S3_ENDPOINT', { infer: true });
    this.client = new S3Client({ ...base, endpoint });
    this.presignClient = new S3Client({
      ...base,
      endpoint: env.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? endpoint,
    });
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<void> {
    await new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
      },
    }).done();
  }

  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty body for object ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!(res.Body instanceof Readable)) throw new Error(`No stream body for object ${key}`);
    return res.Body;
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const res = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (res.Errors?.length) {
      throw new Error(`Failed to delete ${res.Errors.length} object(s)`);
    }
  }

  presignGet(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onModuleDestroy(): void {
    this.client.destroy();
    this.presignClient.destroy();
  }
}
