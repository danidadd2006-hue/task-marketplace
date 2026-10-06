import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDomainEventService } from './notification-domain-event.service.js';
import type { NotificationService } from './notification.service.js';

const mocks = vi.hoisted(() => ({
  applicationFirst: vi.fn(),
  contractFirst: vi.fn(),
  taskFirst: vi.fn(),
  messageFirst: vi.fn(),
  memberAll: vi.fn(),
  paymentFirst: vi.fn(),
  refundFirst: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        Application: { where: () => ({ first: mocks.applicationFirst }) },
        Contract: { where: () => ({ first: mocks.contractFirst }) },
        Task: { where: () => ({ first: mocks.taskFirst }) },
        Message: { where: () => ({ first: mocks.messageFirst }) },
        ConversationMember: { where: () => ({ all: mocks.memberAll }) },
        Payment: { where: () => ({ first: mocks.paymentFirst }) },
        Refund: { where: () => ({ first: mocks.refundFirst }) },
      },
    },
  },
}));

describe('NotificationDomainEventService', () => {
  const createFromDomainEvent = vi.fn();
  const deliverNotification = vi.fn();
  let service: NotificationDomainEventService;

  beforeEach(() => {
    vi.resetAllMocks();
    createFromDomainEvent.mockResolvedValue({ id: 'notification-1', type: 'APPLICATION' });
    deliverNotification.mockResolvedValue({ eligible: true });
    service = new NotificationDomainEventService({
      createFromDomainEvent,
      deliverNotification,
    } as unknown as NotificationService);
  });

  it('emits a deterministic application-created event for the authoritative SUBMITTED application', async () => {
    mocks.applicationFirst.mockResolvedValue({
      id: 'application-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      status: 'SUBMITTED',
    });

    await service.applicationCreated('application-1');

    expect(createFromDomainEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'Application:application-1:application.created:v1',
      eventType: 'application.created',
      aggregateType: 'Application',
      aggregateId: 'application-1',
      notificationType: 'APPLICATION',
      taskId: 'task-1',
      applicationId: 'application-1',
    }));
    expect(createFromDomainEvent.mock.calls[0][0]).not.toHaveProperty('recipientUserId');
    expect(deliverNotification).toHaveBeenCalledTimes(3);
    expect(deliverNotification.mock.calls.map((call) => call[1])).toEqual(['IN_APP', 'EMAIL', 'PUSH']);
  });

  it('does not emit an application-created notification from a non-SUBMITTED application', async () => {
    mocks.applicationFirst.mockResolvedValue({
      id: 'application-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      status: 'ACCEPTED',
    });

    await service.applicationCreated('application-1');

    expect(createFromDomainEvent).not.toHaveBeenCalled();
    expect(deliverNotification).not.toHaveBeenCalled();
  });

  it('emits application-accepted only to the authoritative application worker', async () => {
    mocks.applicationFirst.mockResolvedValue({
      id: 'application-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      status: 'ACCEPTED',
    });

    await service.applicationAccepted('application-1');

    expect(createFromDomainEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'Application:application-1:application.accepted:v1',
      recipientUserId: 'worker-1',
      applicationId: 'application-1',
    }));
  });

  it('emits one contract-created notification per affected party with the same stable event identity', async () => {
    mocks.contractFirst.mockResolvedValue({
      id: 'contract-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      status: 'ACTIVE',
    });
    mocks.taskFirst.mockResolvedValue({
      id: 'task-1',
      clientId: 'client-1',
    });

    await service.contractCreated('contract-1');

    expect(createFromDomainEvent).toHaveBeenCalledTimes(2);
    expect(createFromDomainEvent.mock.calls.map((call) => ({
      eventId: call[0].eventId,
      recipient: call[0].recipientUserId,
    }))).toEqual([
      { eventId: 'Contract:contract-1:contract.created:v1', recipient: 'client-1' },
      { eventId: 'Contract:contract-1:contract.created:v1', recipient: 'worker-1' },
    ]);
  });

  it('derives messaging recipients from conversation membership and excludes the sender', async () => {
    mocks.messageFirst.mockResolvedValue({
      id: 'message-1',
      conversationId: 'conversation-1',
      senderId: 'sender-1',
    });
    mocks.memberAll.mockResolvedValue([
      { userId: 'sender-1' },
      { userId: 'client-1' },
      { userId: 'client-1' },
      { userId: 'worker-1' },
    ]);

    await service.messageCreated('message-1');

    expect(createFromDomainEvent).toHaveBeenCalledTimes(2);
    expect(createFromDomainEvent.mock.calls.map((call) => call[0].recipientUserId)).toEqual([
      'client-1',
      'worker-1',
    ]);
    for (const call of createFromDomainEvent.mock.calls) {
      expect(call[0].eventId).toBe('Message:message-1:message.created:v1');
      expect(call[0]).not.toHaveProperty('referenceMetadata');
    }
  });

  it('emits payment-funded notifications only after authoritative FUNDED state and to payment parties', async () => {
    mocks.paymentFirst.mockResolvedValue({
      id: 'payment-1',
      clientId: 'client-1',
      workerId: 'worker-1',
      status: 'FUNDED',
    });

    await service.paymentFunded('payment-1');

    expect(createFromDomainEvent).toHaveBeenCalledTimes(2);
    expect(createFromDomainEvent.mock.calls.map((call) => call[0].recipientUserId)).toEqual([
      'client-1',
      'worker-1',
    ]);
    expect(createFromDomainEvent.mock.calls[0][0]).toMatchObject({
      eventId: 'Payment:payment-1:payment.funded:v1',
      eventType: 'payment.funded',
      titleKey: 'payment.updated',
      messageKey: 'payment.updated',
    });
  });

  it('does not emit a payment-success notification before FUNDED state', async () => {
    mocks.paymentFirst.mockResolvedValue({
      id: 'payment-1',
      clientId: 'client-1',
      workerId: 'worker-1',
      status: 'PENDING',
    });

    await service.paymentFunded('payment-1');

    expect(createFromDomainEvent).not.toHaveBeenCalled();
  });

  it('emits payment-release notifications only after Payment is RELEASED', async () => {
    mocks.paymentFirst.mockResolvedValue({
      id: 'payment-1',
      clientId: 'client-1',
      workerId: 'worker-1',
      status: 'RELEASED',
    });

    await service.paymentReleased('payment-1');

    expect(createFromDomainEvent).toHaveBeenCalledTimes(2);
    expect(createFromDomainEvent.mock.calls.map((call) => call[0].recipientUserId)).toEqual([
      'client-1',
      'worker-1',
    ]);
    expect(createFromDomainEvent.mock.calls[0][0]).toMatchObject({
      eventId: 'Payment:payment-1:payment.released:v1',
      eventType: 'payment.released',
      notificationType: 'PAYMENT',
      paymentId: 'payment-1',
      titleKey: 'payment.updated',
      messageKey: 'payment.updated',
    });
  });

  it('does not emit payment-release notifications before RELEASED state', async () => {
    mocks.paymentFirst.mockResolvedValue({
      id: 'payment-1',
      clientId: 'client-1',
      workerId: 'worker-1',
      status: 'FUNDED',
    });

    await service.paymentReleased('payment-1');
    expect(createFromDomainEvent).not.toHaveBeenCalled();
  });

  it('emits refund notifications only when Refund is SUCCEEDED and Payment is REFUNDED', async () => {
    mocks.refundFirst.mockResolvedValue({
      id: 'refund-1',
      paymentId: 'payment-1',
      status: 'SUCCEEDED',
    });
    mocks.paymentFirst.mockResolvedValue({
      id: 'payment-1',
      clientId: 'client-1',
      workerId: 'worker-1',
      status: 'REFUNDED',
    });

    await service.refundSucceeded('refund-1');

    expect(createFromDomainEvent).toHaveBeenCalledTimes(2);
    expect(createFromDomainEvent.mock.calls[0][0]).toMatchObject({
      eventId: 'Refund:refund-1:refund.succeeded:v1',
      aggregateType: 'Refund',
      aggregateId: 'refund-1',
      notificationType: 'PAYMENT',
      paymentId: 'payment-1',
      titleKey: 'payment.updated',
      messageKey: 'payment.updated',
      referenceMetadata: {
        paymentId: 'payment-1',
        refundId: 'refund-1',
      },
    });
  });

  it('does not emit refund-success notifications from non-final financial states', async () => {
    mocks.refundFirst.mockResolvedValue({
      id: 'refund-1',
      paymentId: 'payment-1',
      status: 'SUCCEEDED',
    });
    mocks.paymentFirst.mockResolvedValue({
      id: 'payment-1',
      clientId: 'client-1',
      workerId: 'worker-1',
      status: 'FUNDED',
    });

    await service.refundSucceeded('refund-1');

    expect(createFromDomainEvent).not.toHaveBeenCalled();
  });

  it('delegates delivery through NotificationService rather than invoking providers directly', async () => {
    mocks.applicationFirst.mockResolvedValue({
      id: 'application-1',
      taskId: 'task-1',
      workerId: 'worker-1',
      status: 'ACCEPTED',
    });

    await service.applicationAccepted('application-1');

    expect(deliverNotification).toHaveBeenCalledWith('notification-1', 'IN_APP');
    expect(deliverNotification).toHaveBeenCalledWith('notification-1', 'EMAIL');
    expect(deliverNotification).toHaveBeenCalledWith('notification-1', 'PUSH');
  });
});
