import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';
import {
  attachmentAccessTtlSeconds,
  type AttachmentStorageProvider,
} from './attachment-storage.js';

const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const DANGEROUS_MIME = new Set([
  'application/x-msdownload',
  'application/x-sh',
  'application/x-bat',
  'application/vnd.microsoft.portable-executable',
  'text/html',
  'text/javascript',
  'application/javascript',
]);

export const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const VOICE_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
]);

@Injectable()
export class AttachmentService {
  constructor(private readonly storage: AttachmentStorageProvider) {}

  validateMetadata(input: {
    type: 'IMAGE' | 'FILE' | 'VOICE';
    originalFilename?: string;
    mimeType: string;
    size: number;
    checksum: string;
  }) {
    if (!input.originalFilename?.trim() || input.originalFilename.trim().length > 255) {
      throw new BadRequestException('Attachment filename is required and must be at most 255 characters');
    }
    if (!MIME.test(input.mimeType) || DANGEROUS_MIME.has(input.mimeType.toLowerCase())) {
      throw new BadRequestException('Unsupported attachment MIME type');
    }
    if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_ATTACHMENT_SIZE) {
      throw new BadRequestException('Attachment size is outside the allowed range');
    }
    if (!SHA256_HEX.test(input.checksum)) {
      throw new BadRequestException('Attachment checksum must be a SHA-256 hexadecimal digest');
    }
    if (input.type === 'IMAGE' && !IMAGE_MIME_TYPES.has(input.mimeType.toLowerCase())) {
      throw new BadRequestException('IMAGE messages require a supported image MIME type');
    }
    if (input.type === 'VOICE' && !VOICE_MIME_TYPES.has(input.mimeType.toLowerCase())) {
      throw new BadRequestException('VOICE messages require a supported audio MIME type');
    }
    return {
      originalFilename: input.originalFilename.trim(),
      mimeType: input.mimeType.toLowerCase(),
      size: input.size,
      checksum: input.checksum.toLowerCase(),
    };
  }

  async createUploadInstruction(
    user: AuthenticatedUser,
    conversationId: string,
    attachmentId: string,
  ) {
    const attachment = await this.authorizedAttachment(user, conversationId, attachmentId);
    if (attachment.status !== 'PENDING') {
      throw new BadRequestException('Attachment is not awaiting upload');
    }

    const instruction = await this.storage.createUploadInstruction({
      storageKey: attachment.storageKey,
      mimeType: attachment.mimeType,
      size: Number(attachment.size),
      checksum: attachment.checksum,
      expiresInSeconds: Number(process.env['ATTACHMENT_UPLOAD_URL_TTL_SECONDS'] ?? 900),
    });

    return {
      attachmentId: attachment.id,
      status: attachment.status,
      upload: instruction,
    };
  }

  async completeUpload(user: AuthenticatedUser, conversationId: string, attachmentId: string) {
    const attachment = await this.authorizedAttachment(user, conversationId, attachmentId);
    if (attachment.status === 'READY') return this.projectAttachment(attachment);
    if (attachment.status === 'FAILED') {
      throw new BadRequestException('Attachment upload has failed');
    }

    const inspected = await this.storage.inspectObject(attachment.storageKey);
    if (inspected.size !== Number(attachment.size)) {
      await db.orm.public.MessageAttachment.where({ id: attachment.id }).update({ status: 'FAILED' });
      throw new BadRequestException('Uploaded object size does not match the declared attachment size');
    }
    if (inspected.mimeType && inspected.mimeType.toLowerCase() !== attachment.mimeType.toLowerCase()) {
      await db.orm.public.MessageAttachment.where({ id: attachment.id }).update({ status: 'FAILED' });
      throw new BadRequestException('Uploaded object MIME type does not match the declared attachment type');
    }
    if (inspected.checksum && inspected.checksum.toLowerCase() !== attachment.checksum.toLowerCase()) {
      await db.orm.public.MessageAttachment.where({ id: attachment.id }).update({ status: 'FAILED' });
      throw new BadRequestException('Uploaded object checksum does not match the declared checksum');
    }
    if (!inspected.checksum) {
      throw new BadRequestException('Storage provider did not return a verifiable checksum');
    }

    const updated = await db.orm.public.MessageAttachment
      .where({ id: attachment.id })
      .update({ status: 'READY' });
    return this.projectAttachment(updated ?? attachment);
  }

  async getAccess(user: AuthenticatedUser, conversationId: string, attachmentId: string) {
    const attachment = await this.authorizedAttachment(user, conversationId, attachmentId);
    if (attachment.status !== 'READY') {
      throw new NotFoundException('Attachment is not available');
    }

    const access = await this.storage.createAccessInstruction({
      storageKey: attachment.storageKey,
      expiresInSeconds: attachmentAccessTtlSeconds(),
    });

    return {
      attachment: this.projectAttachment(attachment),
      access,
    };
  }

  async deleteObjectForAttachment(user: AuthenticatedUser, conversationId: string, attachmentId: string) {
    const attachment = await this.authorizedAttachment(user, conversationId, attachmentId);
    await this.storage.deleteObject(attachment.storageKey);
  }

  private async authorizedAttachment(
    user: AuthenticatedUser,
    conversationId: string,
    attachmentId: string,
  ) {
    const membership = await db.orm.public.ConversationMember
      .where({ conversationId, userId: user.userId })
      .first();
    if (!membership) throw new ForbiddenException('You are not a member of this conversation');

    const attachment = await db.orm.public.MessageAttachment.where({ id: attachmentId }).first();
    if (!attachment) throw new NotFoundException('Attachment not found');

    const message = await db.orm.public.Message.where({ id: attachment.messageId }).first();
    if (!message || message.conversationId !== conversationId) {
      throw new NotFoundException('Attachment not found');
    }

    return attachment;
  }

  private projectAttachment(attachment: any) {
    return {
      id: attachment.id,
      messageId: attachment.messageId,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      size: String(attachment.size),
      checksum: attachment.checksum,
      status: attachment.status,
      createdAt: attachment.createdAt,
    };
  }
}
