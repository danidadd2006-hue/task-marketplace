# Phase 5 — Step 5.5A — Notification Data Contract

## Scope
This contract establishes durable notification persistence only. Delivery providers, retries, event dispatching, queues, UI, and concrete email/push integrations remain deferred.

## Notification identity
Notification.eventId is an opaque, server-generated stable identifier for one logical domain event.
The idempotency boundary is: eventId + recipientUserId + notificationType.
The database enforces uniqueness with notification_event_recipient_type_key.
eventId must never be client-supplied. Until a general domain-event/outbox abstraction exists, the authoritative domain operation that creates a notification must derive the identifier from its own durable event identity.
A recommended deterministic form is: <aggregateType>:<aggregateId>:<eventType>:<eventVersion>.
The notification record does not become the authoritative domain event.

## Notification record
Notification preserves the legacy id, userId/recipient, type, title, message, readAt, and createdAt fields.
It adds eventId, eventType, aggregateType, aggregateId, optional taskId, contractId, applicationId, paymentId, messageId, referenceMetadata, deepLink, lifecycle status, and expiresAt.
Reference fields are foreign-key constrained and use RESTRICT deletion semantics. General domain events without a dedicated foreign key use aggregateType/aggregateId.
Title and message remain server-controlled compatibility fields. No client-created notification payload is authorized by this schema.
referenceMetadata is structured serialized metadata for safe references/deep-link parameters; it must not contain copied payment records, private message bodies, protected locations, credentials, or other unnecessary sensitive domain data.

## Notification lifecycle
Notification lifecycle is separate from delivery state: ACTIVE, EXPIRED, SUPPRESSED.
Delivery state belongs to NotificationDeliveryAttempt.

## Channels
Supported durable channels: IN_APP, EMAIL, PUSH.
No provider implementation is part of Step 5.5A.

## Preferences
NotificationPreference is unique per userId + notificationType + channel.
No row means the system default applies. This allows defaults without materializing every combination.
Preferences control delivery policy only. They never change authoritative task, application, payment, refund, payout, cancellation, dispute, verification, or account state.
Ordinary operational notifications may be preference-controlled. Security, account-status, and critical financial/operational notifications are policy-protected and must not be assumed suppressible merely because a preference row exists.

## Delivery attempts
NotificationDeliveryAttempt records notification, recipient, channel, attempt number, status, started/completed timestamps, provider/provider reference, provider outcome, error classification, uncertainty information, and creation timestamp.
Statuses: PENDING, PROCESSING, SUCCEEDED, FAILED, UNKNOWN.
Retries are not implemented in Step 5.5A; the unique notificationId + channel + attemptNumber constraint establishes their future idempotency boundary.
Notification delivery failure must never become authoritative financial state.

## Push devices
PushDevice supports multiple devices per user and stores user, provider, platform, token/reference, status, createdAt, updatedAt, and revokedAt.
provider + token is unique. Push devices are not notifications.
No FCM/APNs integration is implemented.

## Acquisition reconstruction
The durable relationship is: domain event → notification → recipient → channel → delivery attempt → provider outcome → timestamp.
The event and aggregate identifiers allow reconstruction without copying complete sensitive domain records into notification rows.

## Reconciliation
The existing Notification table was evolved in place. No duplicate notification table was created.
Pre-migration live row count: notification = 0.
Step 5.5A introduced only additive database operations. No existing notification rows were deleted or rewritten.

## Deferred
NotificationService, controllers/UI, domain-event dispatching, email providers, FCM/APNs, SMS, provider adapters, retries, queues, Redis/Kafka, WebSocket notification delivery, Step 5.5B and later.