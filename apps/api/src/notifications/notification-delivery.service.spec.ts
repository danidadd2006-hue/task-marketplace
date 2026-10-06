import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { NotificationService } from './notification.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { EmailNotificationDeliveryProvider } from './email-notification-delivery.provider.js';
import { InAppNotificationDeliveryProvider } from './in-app-notification-delivery.provider.js';
import { PushNotificationDeliveryProvider } from './push-notification-delivery.provider.js';
import type {
  NotificationDeliveryInstructions,
  NotificationDeliveryNotification,
  NotificationDeliveryProvider,
} from './notification-delivery.provider.js';

const mocks = vi.hoisted(() => ({
  notificationFirst: vi.fn(),
  userFirst: vi.fn(),
  pushDeviceAll: vi.fn(),
  attemptFirst: vi.fn(),
  attemptCreate: vi.fn(),
  attemptUpdate: vi.fn(),
  preferenceAll: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        Notification: {
          where: () => ({ first: mocks.notificationFirst }),
        },
        User: {
          where: () => ({ first: mocks.userFirst }),
        },
        PushDevice: {
          where: (filters: { status?: string }) => ({
            all: filters.status === 'ACTIVE'
              ? mocks.pushDeviceAll
              : mocks.pushDeviceAll,
          }),
        },
        NotificationDeliveryAttempt: {
          where: () => ({
            first: mocks.attemptFirst,
            update: mocks.attemptUpdate,
          }),
          create: mocks.attemptCreate,
        },
        NotificationPreference: {
          where: () => ({ all: mocks.preferenceAll }),
        },
      },
    },
  },
}));

const notification = {
  id: 'n1',
  userId: 'u1',
  type: 'MESSAGE' as const,
  title: 'New message',
  message: 'You have a new message.',
  eventId: 'Message:m1:message.created:v1',
  eventType: 'message.created',
  aggregateType: 'Message',
  aggregateId: 'm1',
  deepLink: '/messages/c1',
  status: 'ACTIVE' as const,
  expiresAt: null,
  referenceMetadata: '{"protectedLocation":"12.34,56.78"}',
};

const activeUser = {
  id: 'u1',
  email: 'authoritative@example.com',
  status: 'ACTIVE',
  passwordHash: 'secret-password-hash',
};

const baseAttempt = {
  id: 'attempt-1',
  notificationId: 'n1',
  recipientUserId: 'u1',
  channel: 'EMAIL' as const,
  attemptNumber: 1,
  status: 'PENDING' as const,
  startedAt: null,
  completedAt: null,
  provider: null,
  providerRef: null,
  providerOutcome: null,
  errorClass: null,
  uncertaintyInfo: null,
  createdAt: '2026-10-06T12:00:00.000Z',
};

const deliveryNotification: NotificationDeliveryNotification = {
  id: 'n1',
  userId: 'u1',
  type: 'MESSAGE',
  title: 'New message',
  message: 'You have a new message.',
  eventId: notification.eventId,
  eventType: notification.eventType,
  aggregateType: notification.aggregateType,
  aggregateId: notification.aggregateId,
  deepLink: notification.deepLink,
};

function makeProvider(
  channel: NotificationDeliveryProvider['channel'],
  outcome: NotificationDeliveryProvider extends never ? never : { status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' },
) {
  return {
    channel,
    deliver: vi.fn().mockResolvedValue(outcome),
  } as unknown as NotificationDeliveryProvider;
}

function makeService(overrides?: {
  inApp?: NotificationDeliveryProvider;
  email?: NotificationDeliveryProvider;
  push?: NotificationDeliveryProvider;
}) {
  return new NotificationDeliveryService(
    (overrides?.inApp ?? makeProvider('IN_APP', { status: 'SUCCEEDED' })) as never,
    (overrides?.email ?? makeProvider('EMAIL', { status: 'UNKNOWN' })) as never,
    (overrides?.push ?? makeProvider('PUSH', { status: 'UNKNOWN' })) as never,
  );
}

describe('NotificationDeliveryService', () => {
  let currentAttempt: any;

  beforeEach(() => {
    vi.resetAllMocks();
    currentAttempt = null;

    mocks.notificationFirst.mockResolvedValue(notification);
    mocks.userFirst.mockResolvedValue(activeUser);
    mocks.preferenceAll.mockResolvedValue([]);
    mocks.pushDeviceAll.mockResolvedValue([
      {
        id: 'device-active',
        userId: 'u1',
        provider: 'local',
        platform: 'WEB',
        token: 'secret-push-token',
        status: 'ACTIVE',
      },
    ]);
    mocks.attemptFirst.mockImplementation(async () => currentAttempt);
    mocks.attemptCreate.mockImplementation(async (input: Record<string, unknown>) => {
      currentAttempt = {
        ...baseAttempt,
        ...input,
        id: 'attempt-1',
      };
      return currentAttempt;
    });
    mocks.attemptUpdate.mockImplementation(async (input: Record<string, unknown>) => {
      currentAttempt = { ...currentAttempt, ...input };
      return 1;
    });
  });

  it('dispatches through the provider selected by the supported channel', async () => {
    const inApp = makeProvider('IN_APP', { status: 'SUCCEEDED' });
    const service = makeService({ inApp });

    const result = await service.deliverPersistedNotification('n1', 'IN_APP', true);

    expect(inApp.deliver).toHaveBeenCalledTimes(1);
    expect(result.attempt?.status).toBe('SUCCEEDED');
    expect(result.attempt?.channel).toBe('IN_APP');
  });

  it('rejects unsupported delivery channels before persistence or dispatch', async () => {
    const service = makeService();

    await expect(service.deliverPersistedNotification('n1', 'SMS', true))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.attemptCreate).not.toHaveBeenCalled();
  });

  it('does not create or dispatch an attempt when preference policy disables the channel', async () => {
    const email = makeProvider('EMAIL', { status: 'SUCCEEDED' });
    const service = makeService({ email });

    const result = await service.deliverPersistedNotification('n1', 'EMAIL', false);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('CHANNEL_DISABLED_BY_NOTIFICATION_POLICY');
    expect(result.attempt).toBeNull();
    expect(mocks.attemptCreate).not.toHaveBeenCalled();
    expect(email.deliver).not.toHaveBeenCalled();
  });

  it('keeps protected notification categories eligible regardless of stored preference', async () => {
    mocks.preferenceAll.mockResolvedValue([
      { channel: 'IN_APP', enabled: false },
      { channel: 'EMAIL', enabled: false },
      { channel: 'PUSH', enabled: false },
    ]);

    const preferenceService = new NotificationService({
      deliverPersistedNotification: vi.fn(),
    } as never);

    for (const type of ['SYSTEM', 'VERIFICATION', 'PAYMENT', 'DISPUTE', 'CONTRACT'] as const) {
      expect(await preferenceService.getPreferenceEligibility('u1', type))
        .toEqual({ IN_APP: true, EMAIL: true, PUSH: true });
    }
  });

  it('records successful in-app delivery as persistence availability, not network delivery', async () => {
    const provider = new InAppNotificationDeliveryProvider();
    const outcome = await provider.deliver(deliveryNotification, {
      channel: 'IN_APP',
      notification: deliveryNotification,
    });

    expect(outcome).toEqual({
      status: 'SUCCEEDED',
      provider: 'local.in-app',
      providerOutcome: 'persistence_available',
    });
  });

  it('records a deterministic failure when push has no active device destination', async () => {
    mocks.pushDeviceAll.mockResolvedValue([]);
    const provider = new PushNotificationDeliveryProvider();
    const service = new NotificationDeliveryService(
      new InAppNotificationDeliveryProvider(),
      new EmailNotificationDeliveryProvider(),
      provider,
    );

    const result = await service.deliverPersistedNotification('n1', 'PUSH', true);

    expect(result.attempt?.status).toBe('FAILED');
    expect(result.attempt?.provider).toBe('local.push.noop');
    expect(result.attempt?.providerOutcome).toBe('no_active_push_device');
    expect(result.attempt?.errorClass).toBe('NO_DESTINATION');
  });

  it('records UNKNOWN when email has an eligible destination but no external provider exists', async () => {
    const email = new EmailNotificationDeliveryProvider();
    const service = new NotificationDeliveryService(
      new InAppNotificationDeliveryProvider(),
      email,
      new PushNotificationDeliveryProvider(),
    );

    const result = await service.deliverPersistedNotification('n1', 'EMAIL', true);

    expect(result.attempt?.status).toBe('UNKNOWN');
    expect(result.attempt?.provider).toBe('local.email.noop');
    expect(result.attempt?.providerOutcome).toBe('external_provider_deferred');
    expect(result.attempt?.uncertaintyInfo).toContain('No external email provider');
  });

  it('rejects invalid state transitions and protects terminal attempts', async () => {
    currentAttempt = { ...baseAttempt, status: 'PENDING' };

    await expect(serviceTransition().transitionAttemptStatus('attempt-1', 'SUCCEEDED', {
      status: 'SUCCEEDED',
    })).rejects.toBeInstanceOf(BadRequestException);

    currentAttempt = { ...baseAttempt, status: 'SUCCEEDED', completedAt: '2026-10-06T12:01:00.000Z' };
    await expect(serviceTransition().transitionAttemptStatus('attempt-1', 'PROCESSING'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('requires normalized provider outcome for every terminal state', async () => {
    currentAttempt = { ...baseAttempt, status: 'PROCESSING' };

    await expect(serviceTransition().transitionAttemptStatus('attempt-1', 'FAILED'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(serviceTransition().transitionAttemptStatus('attempt-1', 'UNKNOWN', {
      status: 'SUCCEEDED',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses server-generated attempt number 1 and does not create a second authoritative attempt on duplicate delivery', async () => {
    const service = new NotificationDeliveryService(
      new InAppNotificationDeliveryProvider(),
      new EmailNotificationDeliveryProvider(),
      new PushNotificationDeliveryProvider(),
    );

    const first = await service.deliverPersistedNotification('n1', 'IN_APP', true);
    const createCallsAfterFirst = mocks.attemptCreate.mock.calls.length;
    const second = await service.deliverPersistedNotification('n1', 'IN_APP', true);

    expect(first.attempt?.attemptNumber).toBe(1);
    expect(second.attempt?.id).toBe(first.attempt?.id);
    expect(mocks.attemptCreate).toHaveBeenCalledTimes(createCallsAfterFirst);
  });

  it('reuses the database winner when concurrent initial-attempt creation hits the uniqueness constraint', async () => {
    let createCalls = 0;
    mocks.attemptCreate.mockImplementation(async (input: Record<string, unknown>) => {
      createCalls += 1;
      if (createCalls === 1) {
        throw { sqlState: '23505' };
      }
      currentAttempt = {
        ...baseAttempt,
        ...input,
        id: 'db-winner',
      };
      return currentAttempt;
    });
    mocks.attemptFirst
      .mockResolvedValueOnce(null)
      .mockImplementation(async () => currentAttempt);

    currentAttempt = {
      ...baseAttempt,
      id: 'db-winner',
      status: 'PENDING',
    };

    const service = new NotificationDeliveryService(
      new InAppNotificationDeliveryProvider(),
      new EmailNotificationDeliveryProvider(),
      new PushNotificationDeliveryProvider(),
    );

    await expect(service.deliverPersistedNotification('n1', 'IN_APP', true))
      .resolves.toMatchObject({ attempt: { id: 'db-winner', attemptNumber: 1 } });
  });

  it('derives email destination from the authoritative account record', async () => {
    let captured: NotificationDeliveryInstructions | undefined;
    const email: NotificationDeliveryProvider = {
      channel: 'EMAIL',
      deliver: vi.fn().mockImplementation(async (_notification, instructions) => {
        captured = instructions;
        return { status: 'UNKNOWN', provider: 'test.email' };
      }),
    };

    const service = makeService({ email });
    await service.deliverPersistedNotification('n1', 'EMAIL', true);

    expect(captured).toMatchObject({
      channel: 'EMAIL',
      recipient: {
        userId: 'u1',
        email: 'authoritative@example.com',
      },
    });
  });

  it('uses only ACTIVE push devices and excludes device tokens from provider instructions', async () => {
    let captured: NotificationDeliveryInstructions | undefined;
    const push: NotificationDeliveryProvider = {
      channel: 'PUSH',
      deliver: vi.fn().mockImplementation(async (_notification, instructions) => {
        captured = instructions;
        return { status: 'UNKNOWN', provider: 'test.push' };
      }),
    };

    const service = makeService({ push });
    await service.deliverPersistedNotification('n1', 'PUSH', true);

    expect(captured).toMatchObject({
      channel: 'PUSH',
      devices: [{ id: 'device-active', provider: 'local', platform: 'WEB' }],
    });
    expect(JSON.stringify(captured)).not.toContain('secret-push-token');
  });

  it('keeps private metadata and account secrets out of provider payloads', async () => {
    let capturedNotification: NotificationDeliveryNotification | undefined;
    const push: NotificationDeliveryProvider = {
      channel: 'PUSH',
      deliver: vi.fn().mockImplementation(async (providerNotification) => {
        capturedNotification = providerNotification;
        return { status: 'UNKNOWN', provider: 'test.push' };
      }),
    };

    const service = makeService({ push });
    await service.deliverPersistedNotification('n1', 'PUSH', true);

    expect(capturedNotification).toBeDefined();
    expect(capturedNotification).not.toHaveProperty('referenceMetadata');
    expect(capturedNotification).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(capturedNotification)).not.toContain('protectedLocation');
    expect(JSON.stringify(capturedNotification)).not.toContain('secret-password-hash');
  });

  it('does not call an external provider when using the local/no-op implementations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const email = new EmailNotificationDeliveryProvider();
    const push = new PushNotificationDeliveryProvider();

    await email.deliver(deliveryNotification, {
      channel: 'EMAIL',
      notification: deliveryNotification,
      recipient: { userId: 'u1', email: 'authoritative@example.com' },
    });

    await push.deliver(deliveryNotification, {
      channel: 'PUSH',
      notification: deliveryNotification,
      devices: [{ id: 'd1', provider: 'local', platform: 'WEB' }],
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('never accepts provider outcome or recipient identity during attempt creation', async () => {
    const service = makeService();

    await service.deliverPersistedNotification('n1', 'IN_APP', true);

    expect(mocks.attemptCreate).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: 'u1',
      attemptNumber: 1,
      status: 'PENDING',
      provider: null,
      providerRef: null,
      providerOutcome: null,
      errorClass: null,
      uncertaintyInfo: null,
    }));
    expect(mocks.attemptCreate.mock.calls[0][0]).not.toHaveProperty('recipientEmail');
    expect(mocks.attemptCreate.mock.calls[0][0]).not.toHaveProperty('providerOutcome', expect.anything());
  });
});

function serviceTransition() {
  return new NotificationDeliveryService(
    new InAppNotificationDeliveryProvider(),
    new EmailNotificationDeliveryProvider(),
    new PushNotificationDeliveryProvider(),
  );
}
