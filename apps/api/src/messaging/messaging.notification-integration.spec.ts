import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingService } from './messaging.service.js';

const mocks = vi.hoisted(() => ({
  conversationFirst: vi.fn(),
  memberFirst: vi.fn(),
  messageCreate: vi.fn(),
  messageFirst: vi.fn(),
  transaction: vi.fn(),
  notificationMessageCreated: vi.fn(),
  realtimePublish: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        Conversation: { where: () => ({ first: mocks.conversationFirst }) },
        ConversationMember: { where: () => ({ first: mocks.memberFirst }) },
      },
    },
    transaction: mocks.transaction,
  },
}));

const user = {
  userId: 'sender-1',
  email: 'sender@example.com',
  roles: ['CLIENT'] as const,
};

const conversation = {
  id: 'conversation-1',
  taskId: 'task-1',
  contractId: null,
};

const persistedMessage = {
  id: 'message-1',
  conversationId: 'conversation-1',
  senderId: 'sender-1',
  type: 'TEXT',
  content: 'private message body',
  attachments: [],
  location: null,
  createdAt: '2026-10-06T12:00:00.000Z',
  updatedAt: '2026-10-06T12:00:00.000Z',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.conversationFirst.mockResolvedValue(conversation);
  mocks.memberFirst.mockResolvedValue({ userId: 'sender-1' });
  mocks.messageCreate.mockResolvedValue({
    id: 'message-1',
    conversationId: 'conversation-1',
    senderId: 'sender-1',
    type: 'TEXT',
    content: 'private message body',
  });
  mocks.messageFirst.mockResolvedValue({
    ...persistedMessage,
  });
  mocks.notificationMessageCreated.mockResolvedValue(undefined);
  mocks.realtimePublish.mockResolvedValue(undefined);

  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      orm: {
        public: {
          Message: {
            create: mocks.messageCreate,
            where: () => ({
              first: mocks.messageFirst,
              include: () => ({
                include: () => ({
                  first: mocks.messageFirst,
                }),
              }),
            }),
          },
          ConversationMember: {
            where: () => ({ first: mocks.memberFirst }),
          },
        },
      },
    }),
  );
});

describe('MessagingService notification integration — Step 5.5D', () => {
  it('emits a trusted message notification only after the authoritative message transaction succeeds', async () => {
    const service = new MessagingService(
      { publishMessageCreated: mocks.realtimePublish } as any,
      undefined,
      { messageCreated: mocks.notificationMessageCreated } as any,
    );

    await service.createMessage(user, 'conversation-1', {
      type: 'TEXT',
      content: 'private message body',
    });

    expect(mocks.messageCreate).toHaveBeenCalledWith(expect.objectContaining({
      senderId: 'sender-1',
      type: 'TEXT',
    }));
    expect(mocks.notificationMessageCreated).toHaveBeenCalledWith('message-1');
    expect(mocks.realtimePublish).toHaveBeenCalled();
  });

  it('does not emit a notification when the authoritative message transaction fails', async () => {
    mocks.messageCreate.mockRejectedValueOnce(new Error('message transaction failed'));

    const service = new MessagingService(
      { publishMessageCreated: mocks.realtimePublish } as any,
      undefined,
      { messageCreated: mocks.notificationMessageCreated } as any,
    );

    await expect(
      service.createMessage(user, 'conversation-1', {
        type: 'TEXT',
        content: 'private message body',
      }),
    ).rejects.toThrow('message transaction failed');

    expect(mocks.notificationMessageCreated).not.toHaveBeenCalled();
  });
});
