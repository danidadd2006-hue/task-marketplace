import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    orm: {
      public: {
        User: { where: vi.fn() },
        UserRoleAssignment: { where: vi.fn() },
        Conversation: { where: vi.fn() },
        ConversationMember: { where: vi.fn() },
      },
    },
  },
}));

vi.mock('../prisma/db.js', () => ({ db: dbMock }));

import { JwtService } from '@nestjs/jwt';
import { MessagingRealtimeGateway } from './messaging-realtime.gateway.js';
import { MessageDeliveryService } from './message-delivery.service.js';

function socket(userId = 'user-1') {
  return {
    handshake: {
      auth: { token: 'token' },
      headers: {},
    },
    data: {
      user: { userId, email: 'user@example.com', roles: ['CLIENT'] },
      subscriptions: new Set<string>(),
    },
    join: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    disconnect: vi.fn(),
  } as any;
}

function activeUser(userId = 'user-1') {
  return {
    id: userId,
    email: 'user@example.com',
    status: 'ACTIVE',
  };
}

describe('MessagingRealtimeGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('accepts a valid JWT and derives identity from the token subject', async () => {
    dbMock.orm.public.User.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(activeUser('user-1')),
    });
    dbMock.orm.public.UserRoleAssignment.where.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ role: 'CLIENT' }]),
    });

    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1', email: 'ignored@example.com' }),
    } as unknown as JwtService;
    const gateway = new MessagingRealtimeGateway(jwt, new MessageDeliveryService());
    const client = socket();

    await gateway.handleConnection(client);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.data.user).toMatchObject({
      userId: 'user-1',
      email: 'user@example.com',
      roles: ['CLIENT'],
    });
  });

  it('rejects an invalid JWT without exposing token details', async () => {
    const jwt = {
      verifyAsync: vi.fn().mockRejectedValue(new Error('bad token')),
    } as unknown as JwtService;
    const gateway = new MessagingRealtimeGateway(jwt, new MessageDeliveryService());
    const client = socket();

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects an inactive account at connection time', async () => {
    dbMock.orm.public.User.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ ...activeUser(), status: 'SUSPENDED' }),
    });

    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1', email: 'ignored@example.com' }),
    } as unknown as JwtService;
    const gateway = new MessagingRealtimeGateway(jwt, new MessageDeliveryService());
    const client = socket();

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('allows an explicit conversation member to subscribe', async () => {
    dbMock.orm.public.User.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(activeUser()),
    });
    dbMock.orm.public.UserRoleAssignment.where.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ role: 'CLIENT' }]),
    });
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ conversationId: 'conversation-1', userId: 'user-1' }),
    });
    dbMock.orm.public.Conversation.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ id: 'conversation-1' }),
    });

    const gateway = new MessagingRealtimeGateway(
      { verifyAsync: vi.fn() } as unknown as JwtService,
      new MessageDeliveryService(),
    );
    const client = socket();

    const result = await gateway.subscribe(client, { conversationId: 'conversation-1' });

    expect(result).toEqual({ ok: true, conversationId: 'conversation-1' });
    expect(client.join).toHaveBeenCalledWith('conversation:conversation-1');
  });

  it('rejects a non-member subscription', async () => {
    dbMock.orm.public.User.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(activeUser()),
    });
    dbMock.orm.public.UserRoleAssignment.where.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ role: 'CLIENT' }]),
    });
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    });

    const gateway = new MessagingRealtimeGateway(
      { verifyAsync: vi.fn() } as unknown as JwtService,
      new MessageDeliveryService(),
    );

    await expect(gateway.subscribe(socket(), { conversationId: 'private-1' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not reveal nonexistent conversations to an unauthorized socket', async () => {
    dbMock.orm.public.User.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(activeUser()),
    });
    dbMock.orm.public.UserRoleAssignment.where.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ role: 'CLIENT' }]),
    });
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    });

    const gateway = new MessagingRealtimeGateway(
      { verifyAsync: vi.fn() } as unknown as JwtService,
      new MessageDeliveryService(),
    );

    await expect(gateway.subscribe(socket(), { conversationId: 'does-not-exist' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(dbMock.orm.public.Conversation.where).not.toHaveBeenCalled();
  });

  it('does not allow task or contract identifiers to bypass membership', async () => {
    dbMock.orm.public.User.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(activeUser()),
    });
    dbMock.orm.public.UserRoleAssignment.where.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ role: 'CLIENT' }]),
    });
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      first: vi.fn().mockResolvedValue(null),
    });

    const gateway = new MessagingRealtimeGateway(
      { verifyAsync: vi.fn() } as unknown as JwtService,
      new MessageDeliveryService(),
    );

    await expect(gateway.subscribe(socket(), {
      conversationId: 'private-1',
      taskId: 'task-1',
      contractId: 'contract-1',
    } as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('disconnects a socket whose account becomes inactive before delivery', async () => {
    dbMock.orm.public.ConversationMember.where.mockReturnValue({
      all: vi.fn().mockResolvedValue([{ userId: 'user-1' }]),
    });
    dbMock.orm.public.User.where.mockReturnValue({
      first: vi.fn().mockResolvedValue({ ...activeUser(), status: 'BANNED' }),
    });

    const gateway = new MessagingRealtimeGateway(
      { verifyAsync: vi.fn() } as unknown as JwtService,
      new MessageDeliveryService(),
    );
    const client = socket();

    const server = {
      in: vi.fn().mockReturnValue({
        fetchSockets: vi.fn().mockResolvedValue([client]),
      }),
    } as any;

    gateway.afterInit(server);

    await gateway.publishMessageCreated({
      eventType: 'MESSAGE_CREATED',
      messageId: 'message-1',
      conversationId: 'conversation-1',
      senderId: 'user-1',
      type: 'TEXT',
      content: 'hello',
      attachments: [],
      location: null,
      createdAt: new Date().toISOString(),
    });

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.emit).not.toHaveBeenCalled();
  });
});
