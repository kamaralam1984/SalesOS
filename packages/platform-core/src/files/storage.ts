import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** Optional host to place in presigned URLs when the browser reaches storage through another address. */
  publicEndpoint?: string;
}

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  if (env.NODE_ENV === 'production') {
    // No silent fallback to the development MinIO endpoint/credentials in production.
    const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`Object storage is not configured for production (missing ${missing.join(', ')})`);
    if (/dev[-_]?only|change[-_]?me|^minioadmin$/i.test(`${env.S3_ACCESS_KEY} ${env.S3_SECRET_KEY}`)) throw new Error('Development object-storage credentials are refused in production');
  }
  return {
    endpoint: env.S3_ENDPOINT ?? 'http://127.0.0.1:9100',
    region: env.S3_REGION ?? 'us-east-1',
    bucket: env.S3_BUCKET ?? `salesos-${env.NODE_ENV ?? 'development'}`,
    accessKey: env.S3_ACCESS_KEY ?? 'salesos_minio',
    secretKey: env.S3_SECRET_KEY ?? 'salesos_minio_dev_only',
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
  };
}

/** Private S3-compatible object store (MinIO in dev, S3/R2 in prod). The bucket is created on boot and never made public. */
export class ObjectStorage {
  private readonly client: S3Client;
  private readonly signer: S3Client;
  private ready: Promise<void> | null = null;

  constructor(readonly cfg: StorageConfig) {
    const base = { region: cfg.region, forcePathStyle: true, credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } };
    this.client = new S3Client({ ...base, endpoint: cfg.endpoint });
    this.signer = new S3Client({ ...base, endpoint: cfg.publicEndpoint ?? cfg.endpoint });
  }

  ensureBucket(): Promise<void> {
    this.ready ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
      }
    })().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: undefined }));
  }

  async get(key: string): Promise<Buffer> {
    await this.ensureBucket();
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  /** Short-lived GET URL forcing download (attachment) and the stored content type. TTL is clamped to <= 300 s. */
  async signedGetUrl(key: string, opts: { ttlSeconds: number; filename: string; contentType: string }): Promise<string> {
    await this.ensureBucket();
    const ttl = Math.max(5, Math.min(300, Math.floor(opts.ttlSeconds)));
    const safeName = opts.filename.replace(/[^\w. ()\-+]/g, '_');
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${safeName}"`, ResponseContentType: opts.contentType }),
      { expiresIn: ttl },
    );
  }
}
