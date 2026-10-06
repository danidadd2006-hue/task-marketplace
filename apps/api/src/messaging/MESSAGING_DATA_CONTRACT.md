# Messaging Data Contract — Phase 5 Step 5.1B

This document resolves the messaging foundation blockers without implementing the messaging system.

## Conversation context

A Conversation may have nullable `taskId` and nullable `contractId`. Both are optional because the foundation does not require every future conversation to originate from a marketplace task or contract.

If both are present, the referenced Contract must belong to the referenced Task. Conversation creation must derive and validate this context server-side; frontend-supplied identifiers are not authoritative.

Conversation membership is explicit through ConversationMember. Arbitrary group-chat functionality is not part of this contract.

## Authorization contract

The required server-side hierarchy is:

Authenticated active User -> explicit ConversationMember -> authoritative Task/Contract relationship -> message operation.

Conversation retrieval and message retrieval require explicit membership. Message creation additionally requires an active authenticated user, membership, a valid message-type payload, and authoritative conversation context. Task-related conversation creation must validate Task authorization; contract-related creation must validate Contract authorization.

Attachment and location access is inherited through the authorized message/conversation. Conversation, message, attachment, and location IDs are identifiers only and never bearer credentials.

## Message types

The durable MessageType values remain exactly:

- TEXT
- IMAGE
- FILE
- VOICE
- LOCATION

The server must reject contradictory payloads rather than trusting the client.

| Type | Required | Optional | Forbidden |
|---|---|---|---|
| TEXT | content | none | attachment, location |
| IMAGE | attachment | content only if captions are intentionally supported | location |
| FILE | attachment | content only if explicitly supported | location |
| VOICE | voice attachment | none | location |
| LOCATION | MessageLocation | none | attachment |

No message editing or hard deletion is introduced by this step. Existing historical records remain reconstructable.

## Attachments

MessageAttachment is provider-neutral metadata. It stores:

- id
- messageId
- storageKey/reference
- originalFilename
- mimeType
- size
- checksum/hash
- createdAt

Binary objects remain outside PostgreSQL. storageKey is an internal provider-independent reference, not a public download URL. The database does not encode S3, R2, MinIO, or another provider. No provider, upload flow, signed URL, or media processing is implemented in this step.

Legacy Message.fileUrl and Message.fileName remain temporarily for compatibility and are deprecated for the new messaging architecture. New messaging design must not depend on them.

Voice messages use the same attachment boundary with voice-specific metadata represented by MIME type, size, checksum, storage reference, and message creation time. No transcoding or processing is implemented here.

## Location contract

MessageLocation remains one-to-one with Message and contains latitude, longitude, optional accuracy, optional expiresAt, and createdAt. Sender identity is inherited through Message.sender; no redundant senderId is stored.

Location visibility is divided into three boundaries:

- public task location: approximate/public
- protected exact location: private
- controlled chat location: exact, conversation-authorized, potentially expiring

Exact chat coordinates must never be exposed through public task discovery. expiresAt remains available for controlled temporary sharing. No location-sharing endpoint is implemented here.

## Storage, realtime, and video boundaries

Messaging Domain -> Attachment/Storage Abstraction -> Object Storage Provider

Messaging Domain -> Message Delivery Abstraction -> Realtime Transport

Messaging Domain -> Video Provider Abstraction -> External Video Provider

The database remains independent of storage, realtime, and video providers. No WebSockets, Socket.IO, Redis, external storage integration, or video provider is implemented in Step 5.1B.

## Acquisition and auditability

The durable reconstruction path is:

Conversation -> Task/Contract context -> ConversationMember records -> Message records -> MessageAttachment / MessageLocation records -> timestamps.

Stable database IDs, provider-independent storage references, explicit membership, structured metadata, and timestamps preserve portability and acquisition readiness. Media binaries remain external to the relational database and can be inventoried through attachment metadata without coupling the domain model to a provider.
