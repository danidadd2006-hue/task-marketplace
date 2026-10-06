import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const contractPath = resolve(process.cwd(), 'src/prisma/contract.prisma');
const contract = readFileSync(contractPath, 'utf8');

function modelBody(name: string) {
  const start = contract.indexOf(`model ${name} {`);
  const end = contract.indexOf('\nmodel ', start + 6);
  if (start < 0) throw new Error(`Missing model ${name}`);
  return contract.slice(start, end < 0 ? contract.length : end);
}

describe('notification data contract', () => {
  it('preserves legacy Notification fields and adds durable event identity', () => {
    const body = modelBody('Notification');
    for (const field of ['id', 'userId', 'type', 'title', 'message', 'readAt', 'createdAt', 'eventId', 'eventType', 'aggregateType', 'aggregateId', 'referenceMetadata', 'deepLink', 'expiresAt']) expect(body).toContain(field);
    expect(body).toContain('@@unique([eventId, userId, type], map: "notification_event_recipient_type_key")');
  });

  it('defines channel, lifecycle, delivery, and push-device contracts', () => {
    for (const value of ['IN_APP', 'EMAIL', 'PUSH']) expect(contract).toContain(value);
    for (const value of ['ACTIVE', 'EXPIRED', 'SUPPRESSED']) expect(contract).toContain(value);
    for (const value of ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN']) expect(contract).toContain(value);
    expect(contract).toContain('model NotificationPreference {');
    expect(contract).toContain('model NotificationDeliveryAttempt {');
    expect(contract).toContain('model PushDevice {');
  });

  it('enforces preference and delivery-attempt idempotency boundaries', () => {
    expect(modelBody('NotificationPreference')).toContain('@@unique([userId, type, channel], map: "notification_preference_user_type_channel_key")');
    expect(modelBody('NotificationDeliveryAttempt')).toContain('@@unique([notificationId, channel, attemptNumber], map: "notification_delivery_attempt_key")');
  });

  it('requires restricted foreign keys for recipient and domain references', () => {
    const body = modelBody('Notification');
    for (const relation of [
      'recipient         User               @relation(fields: [userId], references: [id], onDelete: Restrict)',
      'task              Task?              @relation(fields: [taskId], references: [id], onDelete: Restrict)',
      'contract          Contract?          @relation(fields: [contractId], references: [id], onDelete: Restrict)',
      'application       Application?       @relation(fields: [applicationId], references: [id], onDelete: Restrict)',
      'payment           Payment?            @relation(fields: [paymentId], references: [id], onDelete: Restrict)',
      'messageRecord     Message?           @relation(fields: [messageId], references: [id], onDelete: Restrict)',
    ]) expect(body).toContain(relation);
    expect(modelBody('NotificationDeliveryAttempt')).toContain('onDelete: Restrict');
    expect(modelBody('NotificationPreference')).toContain('onDelete: Restrict');
    expect(modelBody('PushDevice')).toContain('onDelete: Restrict');
  });

  it('keeps defaults policy-based and does not require preference rows for every combination', () => {
    const body = modelBody('NotificationPreference');
    expect(body).toContain('enabled     Boolean            @default(true)');
    expect(body).not.toContain('@@unique([userId, type])');
  });
});