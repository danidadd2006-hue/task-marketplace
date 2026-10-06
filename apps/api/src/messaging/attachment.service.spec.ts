import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AttachmentService } from './attachment.service.js';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    orm: {
      public: {
        ConversationMember: { where: vi.fn() },
        MessageAttachment: { where: vi.fn() },
        Message: { where: vi.fn() },
      },
    },
  },
}));

vi.mock('../prisma/db.js', () => ({ db: dbMock }));

const user = {
  userId: 'user-1',
  email: 'user@example.com',
  roles: ['CLIENT'] as const,
};

function attachment(status: 'PENDING' | 'READY' | 'FAILED' = 'PENDING') {
  return {
    id: 'attachment-1',
    messageId: 'message-1',
    storageKey: 'attachments/attachment-1',
    originalFilename: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: BigInt(100),
    checksum: 'a'.repeat(64),
    status,
    createdAt: new Date().toISOString(),
  };
}

describe('AttachmentService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates filename, MIME, size, and SHA-256 checksum', () => {
    const service = new AttachmentService({} as any);

    expect(() => service.validateMetadata({
      type: 'IMAGE',
      originalFilename: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 100,
      checksum: 'a'.repeat(64),
    })).not.toThrow();

    expect(() => service.validateMetadata({
      type: 'IMAGE',
      originalFilename: 'photo.jpg',
      mimeType: 'application/x-msdownload',
      size: 100,
      checksum: 'a'.repeat(64),
    })).toThrow(BadRequestException);

    expect(() => service.validateMetadata({
      type: 'IMAGE',
      originalFilename: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 100,
      checksum: 'bad',
    })).toThrow(BadRequestException);
  });

  it('denies guessed attachment ids outside the caller conversation', async () => {
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ conversationId: 'conversation-1', userId: user.userId }),
    });
    dbMock.orm.public.MessageAttachment.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(attachment()),
    });
    dbMock.orm.public.Message.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ id: 'message-1', conversationId: 'conversation-2' }),
    });

    const service = new AttachmentService({} as any);

    await expect(service.getAccess(user, 'conversation-1', 'attachment-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires explicit conversation membership before attachment access', async () => {
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    });

    const service = new AttachmentService({} as any);

    await expect(service.getAccess(user, 'conversation-1', 'attachment-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(dbMock.orm.public.MessageAttachment.where).not.toHaveBeenCalled();
  });

  it('completes only after provider metadata matches the declared attachment', async () => {
    const provider = {
      inspectObject: vi.fn().mockResolvedValue({
        size: 100,
        mimeType: 'image/jpeg',
        checksum: 'a'.repeat(64),
      }),
      createAccessInstruction: vi.fn(),
    };
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ conversationId: 'conversation-1', userId: user.userId }),
    });
    dbMock.orm.public.MessageAttachment.where.mockReturnValue({
      first: vi.fn()
        .mockResolvedValueOnce(attachment())
        .mockResolvedValueOnce({ ...attachment(), status: 'READY' }),
      update: vi.fn().mockResolvedValue({ ...attachment(), status: 'READY' }),
    });
    dbMock.orm.public.Message.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ id: 'message-1', conversationId: 'conversation-1' }),
    });

    const service = new AttachmentService(provider as any);
    const result = await service.completeUpload(user, 'conversation-1', 'attachment-1');

    expect(provider.inspectObject).toHaveBeenCalledWith('attachments/attachment-1');
    expect(result.status).toBe('READY');
  });

  it('rejects incomplete attachments from access', async () => {
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ conversationId: 'conversation-1', userId: user.userId }),
    });
    dbMock.orm.public.MessageAttachment.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(attachment('PENDING')),
    });
    dbMock.orm.public.Message.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ id: 'message-1', conversationId: 'conversation-1' }),
    });

    const service = new AttachmentService({} as any);

    await expect(service.getAccess(user, 'conversation-1', 'attachment-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
