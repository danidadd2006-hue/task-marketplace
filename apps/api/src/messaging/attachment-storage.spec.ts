import { describe, expect, it } from 'vitest';
import {
  InMemoryAttachmentStorageProvider,
  createAttachmentStorageProviderFromEnv,
} from './attachment-storage.js';

describe('Attachment storage boundary', () => {
  it('supports upload inspection and temporary access without cloud credentials', async () => {
    const provider = new InMemoryAttachmentStorageProvider();

    const upload = await provider.createUploadInstruction({
      storageKey: 'attachments/a',
      mimeType: 'image/jpeg',
      size: 42,
      checksum: 'a'.repeat(64),
      expiresInSeconds: 900,
    });
    const inspected = await provider.inspectObject('attachments/a');
    const access = await provider.createAccessInstruction({
      storageKey: 'attachments/a',
      expiresInSeconds: 300,
    });

    expect(upload.method).toBe('PUT');
    expect(upload.url).toContain('attachments%2Fa');
    expect(inspected).toEqual({
      size: 42,
      mimeType: 'image/jpeg',
      checksum: 'a'.repeat(64),
    });
    expect(access.url).toContain('attachments%2Fa');
  });

  it('uses a safe disabled provider when production storage is not configured', async () => {
    const original = process.env['ATTACHMENT_STORAGE_PROVIDER'];
    delete process.env['ATTACHMENT_STORAGE_PROVIDER'];
    const provider = createAttachmentStorageProviderFromEnv();

    await expect(provider.createUploadInstruction({
      storageKey: 'attachments/a',
      mimeType: 'image/jpeg',
      size: 42,
      checksum: 'a'.repeat(64),
      expiresInSeconds: 900,
    })).rejects.toThrow('Private attachment storage is not configured');

    if (original === undefined) delete process.env['ATTACHMENT_STORAGE_PROVIDER'];
    else process.env['ATTACHMENT_STORAGE_PROVIDER'] = original;
  });
});
