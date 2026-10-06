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
Step 5.5E hardens the server-authoritative lifecycle: PENDING may only enter PROCESSING; PROCESSING may only enter a terminal state; terminal states cannot transition backwards. Conditional updates make terminal-state races fail closed.
Attempt number 1 is the initial authoritative attempt. Step 5.5E provides an explicit bounded subsequent-attempt foundation with a deterministic maximum of 3 attempts. A later attempt is a new durable row and never overwrites earlier history. UNKNOWN outcomes are not retryable through this foundation without trusted reconciliation, and no automatic retry execution exists.
When the provider boundary supplies a supported classification, errorClass is normalized to a durable category such as PERMANENT_FAILURE, TRANSIENT_FAILURE, UNKNOWN, SUPPRESSED, or NO_DESTINATION while providerOutcome retains the provider/local outcome detail. Local/no-op providers do not fabricate external delivery success.
Preference suppression is durable as a failed attempt with SUPPRESSED classification; later preference changes do not delete or rewrite the notification or historical attempts. Future explicit eligibility may create a subsequent attempt.
Expired or non-active notifications are not dispatched and remain durable for reconstruction. Inactive recipients are treated as having no eligible destination for ordinary delivery.
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
Notification UI, external email providers, FCM/APNs, SMS, provider adapters, automatic retry execution, queues, Redis/Kafka, WebSocket notification delivery, transactional outbox, and Step 5.6.