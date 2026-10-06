import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationService } from './notification.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userFirst: vi.fn(),
  notificationFirst: vi.fn(),
  notificationCreate: vi.fn(),
  notificationUpdate: vi.fn(),
  notificationAll: vi.fn(),
  preferenceAll: vi.fn(),
  messageFirst: vi.fn(),
  memberFirst: vi.fn(),
  applicationFirst: vi.fn(),
  taskFirst: vi.fn(),
  contractFirst: vi.fn(),
  paymentFirst: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        User: { where: () => ({ first: mocks.userFirst }) },
        Notification: { where: () => ({ first: mocks.notificationFirst, create: mocks.notificationCreate, update: mocks.notificationUpdate, orderBy: () => ({ offset: () => ({ limit: () => ({ all: mocks.notificationAll }) }) }) }) },
        NotificationPreference: { where: () => ({ all: mocks.preferenceAll }) },
        Message: { where: () => ({ first: mocks.messageFirst }) },
        ConversationMember: { where: () => ({ first: mocks.memberFirst }) },
        Application: { where: () => ({ first: mocks.applicationFirst }) },
        Task: { where: () => ({ first: mocks.taskFirst }) },
        Contract: { where: () => ({ first: mocks.contractFirst }) },
        Payment: { where: () => ({ first: mocks.paymentFirst }) },
      },
    },
    transaction: mocks.transaction,
  },
}));

const activeUser = { id: 'u-client', email: 'client@example.com', status: 'ACTIVE' };
const activeWorker = { id: 'u-worker', email: 'worker@example.com', status: 'ACTIVE' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    userId: 'u-client',
    type: 'APPLICATION',
    title: 'New application',
    message: 'A worker applied to your task.',
    eventId: 'Task:t1:application.created:v1',
    eventType: 'application.created',
    aggregateType: 'Application',
    aggregateId: 'a1',
    taskId: 't1',
    contractId: null,
    applicationId: 'a1',
    paymentId: null,
    messageId: null,
    referenceMetadata: '{"taskId":"t1"}',
    deepLink: '/tasks/t1/applications/a1',
    status: 'ACTIVE',
    readAt: null,
    expiresAt: null,
    createdAt: '2026-10-06T12:00:00.000Z',
    ...overrides,
  };
}

function makeTx() {
  return {
    orm: {
      public: {
        User: { where: () => ({ first: mocks.userFirst }) },
        Notification: {
          where: () => ({ first: mocks.notificationFirst }),
          create: mocks.notificationCreate,
        },
        Message: { where: () => ({ first: mocks.messageFirst }) },
        ConversationMember: { where: () => ({ first: mocks.memberFirst }) },
        Application: { where: () => ({ first: mocks.applicationFirst }) },
        Task: { where: () => ({ first: mocks.taskFirst }) },
        Contract: { where: () => ({ first: mocks.contractFirst }) },
        Payment: { where: () => ({ first: mocks.paymentFirst }) },
      },
    },
  };
}

describe('NotificationService', () => {
  const service = new NotificationService({
    deliverPersistedNotification: vi.fn(),
  } as never);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(makeTx()));
    mocks.userFirst.mockResolvedValue(activeUser);
    mocks.notificationFirst.mockResolvedValue(null);
    mocks.preferenceAll.mockResolvedValue([]);
  });

  it('creates a server-controlled application notification for the task owner', async () => {
    mocks.applicationFirst.mockResolvedValue({ id: 'a1', taskId: 't1', workerId: 'u-worker' });
    mocks.taskFirst.mockResolvedValue({ id: 't1', clientId: 'u-client' });
    mocks.notificationCreate.mockImplementation(async (input: Record<string, unknown>) => row(input));

    const result = await service.createFromDomainEvent({
      eventId: 'Task:t1:application.created:v1', eventType: 'application.created', aggregateType: 'Application', aggregateId: 'a1',
      notificationType: 'APPLICATION', applicationId: 'a1', recipientUserId: 'u-client', taskId: 't1',
      titleKey: 'application.created', messageKey: 'application.created', referenceMetadata: { taskId: 't1' },
      deepLink: '/tasks/t1/applications/a1',
    });

    expect(result.userId).toBe('u-client');
    expect(result.eventId).toBe('Task:t1:application.created:v1');
    expect(result.referenceMetadata).toContain('taskId');
    expect(result.title).toBe('New application');
    expect(result.message).toBe('A worker applied to your task.');
    expect(mocks.notificationCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-client' }));
  });

  it('reuses an existing notification for the same idempotency boundary', async () => {
    mocks.applicationFirst.mockResolvedValue({ id: 'a1', taskId: 't1', workerId: 'u-worker' });
    mocks.taskFirst.mockResolvedValue({ id: 't1', clientId: 'u-client' });
    mocks.notificationFirst.mockResolvedValue(row());

    const result = await service.createFromDomainEvent({
      eventId: 'Task:t1:application.created:v1', eventType: 'application.created', aggregateType: 'Application', aggregateId: 'a1',
      notificationType: 'APPLICATION', applicationId: 'a1', recipientUserId: 'u-client', taskId: 't1',
      titleKey: 'application.created', messageKey: 'application.created',
    });

    expect(result.id).toBe('n1');
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it('converts a database uniqueness collision into reuse of the concurrent notification', async () => {
    mocks.applicationFirst.mockResolvedValue({ id: 'a1', taskId: 't1', workerId: 'u-worker' });
    mocks.taskFirst.mockResolvedValue({ id: 't1', clientId: 'u-client' });
    mocks.notificationCreate.mockRejectedValue({ sqlState: '23505' });
    mocks.notificationFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row());

    const result = await service.createFromDomainEvent({
      eventId: 'Task:t1:application.created:v1', eventType: 'application.created', aggregateType: 'Application', aggregateId: 'a1',
      notificationType: 'APPLICATION', applicationId: 'a1', recipientUserId: 'u-client', taskId: 't1',
      titleKey: 'application.created', messageKey: 'application.created',
    });

    expect(result.id).toBe('n1');
  });

  it('rejects an unrelated application recipient', async () => {
    mocks.applicationFirst.mockResolvedValue({ id: 'a1', taskId: 't1', workerId: 'u-worker' });
    mocks.taskFirst.mockResolvedValue({ id: 't1', clientId: 'u-client' });

    await expect(service.createFromDomainEvent({
      eventId: 'e1', eventType: 'application.created', aggregateType: 'Application', aggregateId: 'a1', notificationType: 'APPLICATION',
      applicationId: 'a1', recipientUserId: 'u-other', titleKey: 'application.created', messageKey: 'application.created',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires message recipients to be conversation members and never targets the sender', async () => {
    mocks.messageFirst.mockResolvedValue({ id: 'm1', conversationId: 'c1', senderId: 'u-worker' });
    mocks.memberFirst.mockResolvedValue({ id: 'cm1' });
    mocks.notificationCreate.mockImplementation(async (input: Record<string, unknown>) => row({ type: 'MESSAGE', messageId: 'm1', ...input }));

    await expect(service.createFromDomainEvent({
      eventId: 'm-event', eventType: 'message.created', aggregateType: 'Message', aggregateId: 'm1', notificationType: 'MESSAGE',
      messageId: 'm1', recipientUserId: 'u-worker', titleKey: 'message.created', messageKey: 'message.created',
    })).rejects.toThrow();

    mocks.notificationFirst.mockResolvedValue(null);
    await expect(service.createFromDomainEvent({
      eventId: 'm-event-2', eventType: 'message.created', aggregateType: 'Message', aggregateId: 'm1', notificationType: 'MESSAGE',
      messageId: 'm1', recipientUserId: 'u-client', titleKey: 'message.created', messageKey: 'message.created',
    })).resolves.toBeTruthy();
  });

  it('evaluates missing, enabled, and disabled preferences without deleting the notification', async () => {
    expect(await service.getPreferenceEligibility('u-client', 'APPLICATION')).toEqual({ IN_APP: true, EMAIL: true, PUSH: true });
    mocks.preferenceAll.mockResolvedValueOnce([{ channel: 'EMAIL', enabled: false }, { channel: 'PUSH', enabled: true }]);
    expect(await service.getPreferenceEligibility('u-client', 'APPLICATION')).toEqual({ IN_APP: true, EMAIL: false, PUSH: true });
    mocks.applicationFirst.mockResolvedValue({ id: 'a1', taskId: 't1', workerId: 'u-worker' });
    mocks.taskFirst.mockResolvedValue({ id: 't1', clientId: 'u-client' });
    mocks.notificationCreate.mockImplementation(async (input: Record<string, unknown>) => row(input));
    await expect(service.createFromDomainEvent({
      eventId: 'e2', eventType: 'application.created', aggregateType: 'Application', aggregateId: 'a1', notificationType: 'APPLICATION',
      applicationId: 'a1', recipientUserId: 'u-client', titleKey: 'application.created', messageKey: 'application.created',
    })).resolves.toBeTruthy();
  });

  it('protects security and critical channels from preference suppression', async () => {
    mocks.preferenceAll.mockResolvedValue([
      { channel: 'IN_APP', enabled: false }, { channel: 'EMAIL', enabled: false }, { channel: 'PUSH', enabled: false },
    ]);
    expect(await service.getPreferenceEligibility('u-client', 'PAYMENT')).toEqual({ IN_APP: true, EMAIL: true, PUSH: true });
    expect(await service.getPreferenceEligibility('u-client', 'SYSTEM')).toEqual({ IN_APP: true, EMAIL: true, PUSH: true });
  });

  it('keeps sensitive notification content out of the projection', async () => {
    mocks.applicationFirst.mockResolvedValue({ id: 'a1', taskId: 't1', workerId: 'u-worker' });
    mocks.taskFirst.mockResolvedValue({ id: 't1', clientId: 'u-client' });
    mocks.notificationCreate.mockImplementation(async (input: Record<string, unknown>) => row(input));

    const result = await service.createFromDomainEvent({
      eventId: 'e3', eventType: 'application.created', aggregateType: 'Application', aggregateId: 'a1', notificationType: 'APPLICATION',
      applicationId: 'a1', recipientUserId: 'u-client', titleKey: 'application.created', messageKey: 'application.created',
      referenceMetadata: { taskId: 't1', storageKey: null },
    });

    expect(result.message).not.toContain('password');
    expect(result.message).not.toContain('token');
    expect(result.referenceMetadata).not.toContain('providerCredential');
  });

  it('allows a user to read and mark only their own notifications', async () => {
    mocks.notificationFirst.mockResolvedValue(row());
    mocks.notificationUpdate.mockResolvedValue(1);
    await expect(service.getForUser({ userId: 'u-client', email: activeUser.email, roles: ['CLIENT'] }, 'n1')).resolves.toHaveProperty('id', 'n1');
    await expect(service.markRead({ userId: 'u-client', email: activeUser.email, roles: ['CLIENT'] }, 'n1')).resolves.toHaveProperty('readAt');

    mocks.notificationFirst.mockResolvedValue(null);
    await expect(service.getForUser({ userId: 'u-worker', email: activeWorker.email, roles: ['WORKER'] }, 'n1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.markRead({ userId: 'u-worker', email: activeWorker.email, roles: ['WORKER'] }, 'n1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects notification access for inactive accounts', async () => {
    mocks.userFirst.mockResolvedValue({ ...activeUser, status: 'SUSPENDED' });
    await expect(service.listForUser({ userId: 'u-client', email: activeUser.email, roles: ['CLIENT'] })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
