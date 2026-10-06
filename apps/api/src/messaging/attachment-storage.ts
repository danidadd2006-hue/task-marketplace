import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface AttachmentUploadInstruction {
  url: string;
  method: 'PUT';
  expiresAt: string;
  headers: Record<string, string>;
}

export interface AttachmentAccessInstruction {
  url: string;
  expiresAt: string;
}

export interface AttachmentObjectMetadata {
  size: number;
  mimeType: string | null;
  checksum: string | null;
}

export interface AttachmentStorageProvider {
  createUploadInstruction(input: {
    storageKey: string;
    mimeType: string;
    size: number;
    checksum: string;
    expiresInSeconds: number;
  }): Promise<AttachmentUploadInstruction>;
  inspectObject(storageKey: string): Promise<AttachmentObjectMetadata>;
  createAccessInstruction(input: {
    storageKey: string;
    expiresInSeconds: number;
  }): Promise<AttachmentAccessInstruction>;
  deleteObject(storageKey: string): Promise<void>;
}

export class AttachmentStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentStorageConfigurationError';
  }
}

export class S3CompatibleAttachmentStorageProvider implements AttachmentStorageProvider {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly uploadTtlSeconds: number,
    private readonly accessTtlSeconds: number,
    config: S3ClientConfig,
  ) {
    this.client = new S3Client(config);
  }

  async createUploadInstruction(input: {
    storageKey: string;
    mimeType: string;
    size: number;
    checksum: string;
    expiresInSeconds: number;
  }): Promise<AttachmentUploadInstruction> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.storageKey,
      ContentType: input.mimeType,
      Metadata: { sha256: input.checksum },
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
    });
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();
    return {
      url,
      method: 'PUT',
      expiresAt,
      headers: {
        'content-type': input.mimeType,
        'x-amz-meta-sha256': input.checksum,
      },
    };
  }

  async inspectObject(storageKey: string): Promise<AttachmentObjectMetadata> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
    const checksum = result.Metadata?.['sha256'] ?? result.ChecksumSHA256 ?? null;
    return {
      size: Number(result.ContentLength ?? 0),
      mimeType: result.ContentType ?? null,
      checksum,
    };
  }

  async createAccessInstruction(input: {
    storageKey: string;
    expiresInSeconds: number;
  }): Promise<AttachmentAccessInstruction> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.storageKey,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    }));
  }
}

export class InMemoryAttachmentStorageProvider implements AttachmentStorageProvider {
  private readonly objects = new Map<string, AttachmentObjectMetadata>();

  async createUploadInstruction(input: {
    storageKey: string;
    mimeType: string;
    size: number;
    checksum: string;
    expiresInSeconds: number;
  }): Promise<AttachmentUploadInstruction> {
    this.objects.set(input.storageKey, {
      size: input.size,
      mimeType: input.mimeType,
      checksum: input.checksum,
    });
    return {
      url: `https://storage.test/upload/${encodeURIComponent(input.storageKey)}`,
      method: 'PUT',
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      headers: {
        'content-type': input.mimeType,
        'x-test-checksum': input.checksum,
      },
    };
  }

  async inspectObject(storageKey: string): Promise<AttachmentObjectMetadata> {
    const object = this.objects.get(storageKey);
    if (!object) throw new Error('Object not found');
    return object;
  }

  async createAccessInstruction(input: {
    storageKey: string;
    expiresInSeconds: number;
  }): Promise<AttachmentAccessInstruction> {
    if (!this.objects.has(input.storageKey)) throw new Error('Object not found');
    return {
      url: `https://storage.test/access/${encodeURIComponent(input.storageKey)}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }
}

export function createAttachmentStorageProviderFromEnv(): AttachmentStorageProvider {
  const provider = process.env['ATTACHMENT_STORAGE_PROVIDER']?.trim().toLowerCase();
  if (provider === 'mock') {
    return new InMemoryAttachmentStorageProvider();
  }
  if (provider !== 's3') {
    return {
      async createUploadInstruction() {
        throw new AttachmentStorageConfigurationError(
          'Private attachment storage is not configured',
        );
      },
      async inspectObject() {
        throw new AttachmentStorageConfigurationError(
          'Private attachment storage is not configured',
        );
      },
      async createAccessInstruction() {
        throw new AttachmentStorageConfigurationError(
          'Private attachment storage is not configured',
        );
      },
      async deleteObject() {},
    };
  }

  const bucket = process.env['ATTACHMENT_STORAGE_BUCKET'];
  const region = process.env['ATTACHMENT_STORAGE_REGION'];
  const accessKeyId = process.env['ATTACHMENT_STORAGE_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['ATTACHMENT_STORAGE_SECRET_ACCESS_KEY'];
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new AttachmentStorageConfigurationError(
      'S3 attachment storage requires bucket, region, access key, and secret key configuration',
    );
  }

  const endpoint = process.env['ATTACHMENT_STORAGE_ENDPOINT']?.trim() || undefined;
  const forcePathStyle = process.env['ATTACHMENT_STORAGE_FORCE_PATH_STYLE'] === 'true';
  const uploadTtlSeconds = Number(process.env['ATTACHMENT_UPLOAD_URL_TTL_SECONDS'] ?? 900);
  const accessTtlSeconds = Number(process.env['ATTACHMENT_ACCESS_URL_TTL_SECONDS'] ?? 300);

  if (!Number.isInteger(uploadTtlSeconds) || uploadTtlSeconds < 60 || uploadTtlSeconds > 3600) {
    throw new AttachmentStorageConfigurationError('Invalid attachment upload URL TTL configuration');
  }
  if (!Number.isInteger(accessTtlSeconds) || accessTtlSeconds < 30 || accessTtlSeconds > 3600) {
    throw new AttachmentStorageConfigurationError('Invalid attachment access URL TTL configuration');
  }

  return new S3CompatibleAttachmentStorageProvider(
    bucket,
    uploadTtlSeconds,
    accessTtlSeconds,
    {
      region,
      endpoint,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    },
  );
}

export function attachmentUploadTtlSeconds(): number {
  return Number(process.env['ATTACHMENT_UPLOAD_URL_TTL_SECONDS'] ?? 900);
}

export function attachmentAccessTtlSeconds(): number {
  return Number(process.env['ATTACHMENT_ACCESS_URL_TTL_SECONDS'] ?? 300);
}
