import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    orm: {
      public: {
        Conversation: { where: vi.fn() },
        ConversationMember: { where: vi.fn() },
        Task: { where: vi.fn() },
        Contract: { where: vi.fn() },
        Application: { where: vi.fn() },
      },
    },
    transaction: vi.fn(),
  },
}));

vi.mock('../prisma/db.js', () => ({ db: dbMock }));

import { validateMessagePayload, MessagingService } from './messaging.service.js';

const user = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'client@example.com',
  roles: ['CLIENT'] as const,
};

describe('validateMessagePayload', () => {
  it('accepts TEXT with content only', () => {
    expect(validateMessagePayload({ type: 'TEXT', content: 'hello' })).toMatchObject({
      type: 'TEXT',
    });
  });

  it('accepts IMAGE, FILE, and VOICE with attachments', () => {
    const attachment = {
      storageKey: 'messages/a',
      originalFilename: 'a.txt',
      mimeType: 'application/octet-stream',
      size: 10,
      checksum: 'abc',
    };

    expect(validateMessagePayload({ type: 'IMAGE', attachments: [attachment] }).type).toBe('IMAGE');
    expect(validateMessagePayload({ type: 'FILE', attachments: [attachment] }).type).toBe('FILE');
    expect(
      validateMessagePayload({
        type: 'VOICE',
        attachments: [{ ...attachment, mimeType: 'audio/webm' }],
      }).type,
    ).toBe('VOICE');
  });

  it('accepts LOCATION with location only', () => {
    expect(
      validateMessagePayload({
        type: 'LOCATION',
        location: { latitude: 0, longitude: 0 },
      }).type,
    ).toBe('LOCATION');
  });

  it('rejects contradictory payloads', () => {
    expect(() => validateMessagePayload({ type: 'TEXT' })).toThrow(BadRequestException);
    expect(() =>
      validateMessagePayload({
        type: 'TEXT',
        content: 'hello',
        attachments: [{
          mimeType: 'text/plain',
          size: 1,
          checksum: 'abc',
        }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateMessagePayload({
        type: 'LOCATION',
        location: { latitude: 0, longitude: 0 },
        attachments: [{
          mimeType: 'text/plain',
          size: 1,
          checksum: 'abc',
        }],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid voice and oversized attachment metadata', () => {
    expect(() =>
      validateMessagePayload({
        type: 'VOICE',
        attachments: [{
          mimeType: 'application/octet-stream',
          size: 1,
          checksum: 'abc',
        }],
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateMessagePayload({
        type: 'FILE',
        attachments: [{
          mimeType: 'application/octet-stream',
          size: 100 * 1024 * 1024 + 1,
          checksum: 'abc',
        }],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects expired location metadata at creation time', () => {
    expect(() =>
      validateMessagePayload({
        type: 'LOCATION',
        location: {
          latitude: 0,
          longitude: 0,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      }),
    ).toThrow(BadRequestException);
  });
});

describe('MessagingService authorization', () => {
  it('rejects message creation for a non-member even with a valid conversation id', async () => {
    const conversation = {
      id: '22222222-2222-4222-8222-222222222222',
      taskId: '33333333-3333-4333-8333-333333333333',
      contractId: null,
    };

    dbMock.orm.public.Conversation.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(conversation),
    });
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    });

    const service = new MessagingService({ publishMessageCreated: vi.fn() } as any);

    await expect(
      service.createMessage(user, conversation.id, { type: 'TEXT', content: 'secret' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects task conversation creation when the requester is neither the client nor an applicant', async () => {
    const task = {
      id: '33333333-3333-4333-8333-333333333333',
      clientId: '44444444-4444-4444-8444-444444444444',
    };

    dbMock.orm.public.Task.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(task),
    });
    dbMock.orm.public.Contract.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    });
    dbMock.orm.public.Application.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    });

    const service = new MessagingService({ publishMessageCreated: vi.fn() } as any);

    await expect(
      service.createConversation(user, {
        taskId: task.id,
        participantUserId: '55555555-5555-4555-8555-555555555555',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
