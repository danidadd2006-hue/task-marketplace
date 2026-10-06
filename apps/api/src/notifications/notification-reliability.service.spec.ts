import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import type {
  NotificationDeliveryInstructions,
  NotificationDeliveryNotification,
  NotificationDeliveryProvider,
} from './notification-delivery.provider.js';

const mocks = vi.hoisted(() => ({
  notificationFirst: vi.fn(),
  userFirst: vi.fn(),
  attemptFirst: vi.fn(),
  attemptAll: vi.fn(),
  attemptCreate: vi.fn(),
  attemptUpdate: vi.fn(),
  pushDeviceAll: vi.fn(),
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
          where: () => ({ all: mocks.pushDeviceAll }),
        },
        NotificationDeliveryAttempt: {
          where: (filters: Record<string, unknown>) => ({
            first: () => mocks.attemptFirst(filters),
            all: () => mocks.attemptAll(filters),
            update: (input: Record<string, unknown>) => mocks.attemptUpdate(filters, input),
          }),
          create: mocks.attemptCreate,
        },
      },
    },
  },
}));

const baseNotification = {
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
  expiresAt: null as string | null,
};

const baseUser = {
  id: 'u1',
  email: 'authoritative@example.com',
  status: 'ACTIVE',
};

const baseAttempt = {
  id: 'attempt-1',
  notificationId: 'n1',
  recipientUserId: 'u1',
  channel: 'IN_APP' as const,
  attemptNumber: 1,
  status: 'PENDING' as const,
  startedAt: null,
  completedAt: null,
  provider: null,
  providerRef: null,
  providerOutcome: null,
  errorClass: null,
  uncertaintyInfo: null,
  createdAt: '2026-10-07T00:00:00.000Z',
};

function provider(
  channel: NotificationDeliveryProvider['channel'],
  outcome: { status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; provider?: string; providerRef?: string; providerOutcome?: string; errorClass?: string; uncertaintyInfo?: string },
): NotificationDeliveryProvider {
  return {
    channel,
    deliver: vi.fn().mockResolvedValue(outcome),
  };
}

function makeService(overrides: {
  inApp?: NotificationDeliveryProvider;
  email?: NotificationDeliveryProvider;
  push?: NotificationDeliveryProvider;
} = {}) {
  return new NotificationDeliveryService(
    (overrides.inApp ?? provider('IN_APP', { status: 'SUCCEEDED', provider: 'test.in-app', providerOutcome: 'accepted' })) as never,
    (overrides.email ?? provider('EMAIL', { status: 'UNKNOWN', provider: 'test.email', providerOutcome: 'deferred' })) as never,
    (overrides.push ?? provider('PUSH', { status: 'UNKNOWN', provider: 'test.push', providerOutcome: 'deferred' })) as never,
  );
}

describe('Step 5.5E notification delivery reliability', () => {
  let notification: typeof baseNotification;
  let user: typeof baseUser;
  let attempts: any[];

  beforeEach(() => {
    vi.resetAllMocks();
    notification = { ...baseNotification };
    user = { ...baseUser };
    attempts = [];

    mocks.notificationFirst.mockImplementation(async () => notification);
    mocks.userFirst.mockImplementation(async () => user);
    mocks.pushDeviceAll.mockResolvedValue([]);
    mocks.attemptFirst.mockImplementation(async (filters: Record<string, unknown>) =>
      attempts.find((attempt) => Object.entries(filters).every(([key, value]) => attempt[key] === value)) ?? null,
    );
    mocks.attemptAll.mockImplementation(async (filters: Record<string, unknown>) =>
      attempts.filter((attempt) => Object.entries(filters).every(([key, value]) => attempt[key] === value)),
    );
    mocks.attemptCreate.mockImplementation(async (input: Record<string, unknown>) => {
      if (attempts.some((attempt) =>
        attempt.notificationId === input.notificationId &&
        attempt.channel === input.channel &&
        attempt.attemptNumber === input.attemptNumber
      )) {
        throw { sqlState: '23505' };
      }
      const created = {
        ...baseAttempt,
        ...input,
        id: 'attempt-' + input.attemptNumber,
        createdAt: new Date().toISOString(),
      };
      attempts.push(created);
      return created;
    });
    mocks.attemptUpdate.mockImplementation(async (filters: Record<string, unknown>, input: Record<string, unknown>) => {
      const attempt = attempts.find((candidate) =>
        Object.entries(filters).every(([key, value]) => candidate[key] === value),
      );
      if (!attempt) return 0;
      Object.assign(attempt, input);
      return 1;
    });
  });

  it('enforces PENDING → PROCESSING → terminal and records a trusted success', async () => {
    const result = await makeService().deliverPersistedNotification('n1', 'IN_APP', true);

    expect(result.attempt).toMatchObject({
      attemptNumber: 1,
      status: 'SUCCEEDED',
      provider: 'test.in-app',
      providerOutcome: 'accepted',
      errorClass: null,
    });
    expect(attempts).toHaveLength(1);
  });

  it('blocks backward transitions and rejects success without a real provider outcome', async () => {
    attempts.push({ ...baseAttempt, status: 'SUCCEEDED' });
    await expect(makeService().transitionAttemptStatus('attempt-1', 'PROCESSING'))
      .rejects.toBeInstanceOf(ConflictException);

    attempts[0].status = 'PROCESSING';
    await expect(makeService().transitionAttemptStatus('attempt-1', 'SUCCEEDED', {
      status: 'SUCCEEDED',
      providerRef: 'reference-only',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps concurrent processing requests from dispatching twice', async () => {
    let release: (() => void) | undefined;
    let resolveEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { resolveEntered = resolve; });
    const inApp = provider('IN_APP', { status: 'SUCCEEDED', provider: 'test.in-app', providerOutcome: 'accepted' });
    inApp.deliver = vi.fn().mockImplementation(async () => {
      resolveEntered?.();
      await new Promise<void>((resolve) => { release = resolve; });
      return { status: 'SUCCEEDED', provider: 'test.in-app', providerOutcome: 'accepted' };
    });
    const service = makeService({ inApp });

    const first = service.deliverPersistedNotification('n1', 'IN_APP', true);
    await entered;

    await expect(service.deliverPersistedNotification('n1', 'IN_APP', true))
      .rejects.toBeInstanceOf(ConflictException);

    release?.();
    await first;
    expect(inApp.deliver).toHaveBeenCalledTimes(1);
  });

  it('protects a terminal finalization race with the conditional status update', async () => {
    attempts.push({ ...baseAttempt, status: 'PROCESSING' });
    const results = await Promise.allSettled([
      makeService().transitionAttemptStatus('attempt-1', 'FAILED', {
        status: 'FAILED',
        provider: 'test.provider',
        providerOutcome: 'permanent_failure',
        errorClass: 'PERMANENT_FAILURE',
      }),
      makeService().transitionAttemptStatus('attempt-1', 'UNKNOWN', {
        status: 'UNKNOWN',
        provider: 'test.provider',
        providerOutcome: 'uncertain',
        uncertaintyInfo: 'provider outcome uncertain',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(attempts[0].status).toMatch(/FAILED|UNKNOWN/);
  });

  it('reuses the uniqueness winner for duplicate initial-attempt creation', async () => {
    const service = makeService();
    const results = await Promise.allSettled([
      service.deliverPersistedNotification('n1', 'IN_APP', true),
      service.deliverPersistedNotification('n1', 'IN_APP', true),
    ]);

    expect(attempts).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'fulfilled')).toMatchObject({
      value: { attempt: { id: 'attempt-1' } },
    });
  });

  it('creates a bounded subsequent attempt without overwriting history', async () => {
    attempts.push({
      ...baseAttempt,
      status: 'FAILED',
      errorClass: 'TRANSIENT_FAILURE',
      provider: 'test.provider',
      providerOutcome: 'temporary_failure',
      completedAt: '2026-10-07T00:01:00.000Z',
    });

    const service = makeService();
    const retry = await service.createSubsequentAttempt('n1', 'IN_APP', true);

    expect(retry).toMatchObject({ attemptNumber: 2, status: 'PENDING' });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ attemptNumber: 1, status: 'FAILED', errorClass: 'TRANSIENT_FAILURE' });

    attempts[1].status = 'FAILED';
    const third = await service.createSubsequentAttempt('n1', 'IN_APP', true);
    expect(third.attemptNumber).toBe(3);

    attempts[2].status = 'FAILED';
    await expect(service.createSubsequentAttempt('n1', 'IN_APP', true))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('never retries UNKNOWN implicitly or through the bounded retry foundation', async () => {
    attempts.push({
      ...baseAttempt,
      status: 'UNKNOWN',
      provider: 'test.email',
      providerOutcome: 'external_provider_deferred',
      uncertaintyInfo: 'no external provider was configured',
    });

    await expect(makeService().createSubsequentAttempt('n1', 'IN_APP', true))
      .rejects.toThrow('trusted reconciliation');
  });

  it('normalizes durable failure classes and preserves the provider outcome detail', async () => {
    const inApp = provider('IN_APP', {
      status: 'FAILED',
      provider: 'test.in-app',
      providerOutcome: 'temporary_failure',
      errorClass: 'TRANSIENT_FAILURE',
    });
    const result = await makeService({ inApp }).deliverPersistedNotification('n1', 'IN_APP', true);

    expect(result.attempt).toMatchObject({
      status: 'FAILED',
      errorClass: 'TRANSIENT_FAILURE',
      providerOutcome: 'temporary_failure',
    });
  });

  it('records suppression as a durable failure without invoking a provider', async () => {
    const inApp = provider('IN_APP', { status: 'SUCCEEDED', provider: 'test.in-app', providerOutcome: 'accepted' });

    const result = await makeService({ inApp }).deliverPersistedNotification('n1', 'IN_APP', false);

    expect(result).toMatchObject({
      eligible: false,
      reason: 'CHANNEL_DISABLED_BY_NOTIFICATION_POLICY',
    });
    expect(result.attempt).toMatchObject({
      status: 'FAILED',
      errorClass: 'SUPPRESSED',
      provider: null,
      providerOutcome: 'channel_suppressed_by_notification_policy',
    });
    expect(inApp.deliver).not.toHaveBeenCalled();
  });

  it('blocks delivery for an inactive account and classifies it as no destination', async () => {
    user.status = 'SUSPENDED';
    const inApp = provider('IN_APP', { status: 'SUCCEEDED', provider: 'test.in-app', providerOutcome: 'accepted' });

    const result = await makeService({ inApp }).deliverPersistedNotification('n1', 'IN_APP', true);

    expect(result.attempt).toMatchObject({
      status: 'FAILED',
      errorClass: 'NO_DESTINATION',
      providerOutcome: 'recipient_account_inactive',
    });
    expect(inApp.deliver).not.toHaveBeenCalled();
  });

  it('does not create delivery attempts for already expired notifications', async () => {
    notification.expiresAt = '2000-01-01T00:00:00.000Z';

    const result = await makeService().deliverPersistedNotification('n1', 'IN_APP', true);

    expect(result.reason).toBe('NOTIFICATION_EXPIRED');
    expect(result.attempt).toBeNull();
    expect(attempts).toHaveLength(0);
  });

  it('rechecks expiry after claiming an attempt so an expiry race cannot dispatch', async () => {
    const future = { ...baseNotification, expiresAt: '2099-01-01T00:00:00.000Z' };
    const expired = { ...baseNotification, expiresAt: '2000-01-01T00:00:00.000Z' };
    mocks.notificationFirst.mockResolvedValueOnce(future).mockResolvedValueOnce(expired);

    const inApp = provider('IN_APP', { status: 'SUCCEEDED', provider: 'test.in-app', providerOutcome: 'accepted' });
    const result = await makeService({ inApp }).deliverPersistedNotification('n1', 'IN_APP', true);

    expect(result.attempt).toMatchObject({
      status: 'FAILED',
      errorClass: 'SUPPRESSED',
      providerOutcome: 'notification_expired',
    });
    expect(inApp.deliver).not.toHaveBeenCalled();
  });

  it('preserves history when a later retry is explicitly delivered', async () => {
    const inApp = provider('IN_APP', { status: 'FAILED', provider: 'test.in-app', providerOutcome: 'temporary_failure', errorClass: 'TRANSIENT_FAILURE' });
    const service = makeService({ inApp });

    await service.deliverPersistedNotification('n1', 'IN_APP', true);
    await service.createSubsequentAttempt('n1', 'IN_APP', true);

    inApp.deliver = vi.fn().mockResolvedValue({
      status: 'SUCCEEDED',
      provider: 'test.in-app',
      providerOutcome: 'accepted',
    });

    const result = await service.deliverPersistedNotification('n1', 'IN_APP', true);

    expect(result.attempt?.attemptNumber).toBe(2);
    expect(result.attempt?.status).toBe('SUCCEEDED');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      status: 'FAILED',
      errorClass: 'TRANSIENT_FAILURE',
    });
  });

  it('does not treat a provider reference alone as proof of success and keeps uncertainty explicit', async () => {
    const inApp = provider('IN_APP', {
      status: 'SUCCEEDED',
      provider: 'attacker-shaped-value',
      providerRef: 'reference-only',
    });

    const result = await makeService({ inApp }).deliverPersistedNotification('n1', 'IN_APP', true);

    expect(result.attempt?.status).toBe('UNKNOWN');
    expect(result.attempt?.errorClass).toBe('UNKNOWN');
    expect(result.attempt?.provider).toBeNull();
    expect(result.attempt?.providerRef).toBeNull();
  });

  it('keeps provider instructions free of push tokens and notification private metadata', async () => {
    mocks.pushDeviceAll.mockResolvedValue([{
      id: 'device-1',
      provider: 'local',
      platform: 'WEB',
      token: 'secret-push-token',
      status: 'ACTIVE',
    }]);

    let captured: NotificationDeliveryNotification | undefined;
    let instructions: NotificationDeliveryInstructions | undefined;
    const push: NotificationDeliveryProvider = {
      channel: 'PUSH',
      deliver: vi.fn().mockImplementation(async (value, supplied) => {
        captured = value;
        instructions = supplied;
        return { status: 'UNKNOWN', provider: 'test.push', providerOutcome: 'deferred' };
      }),
    };

    await makeService({ push }).deliverPersistedNotification('n1', 'PUSH', true);

    expect(captured).toBeDefined();
    expect(captured).not.toHaveProperty('referenceMetadata');
    expect(captured).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(captured)).not.toContain('secret-push-token');
    expect(JSON.stringify(instructions)).not.toContain('secret-push-token');
  });
});
