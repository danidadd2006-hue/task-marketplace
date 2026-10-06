import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { db } from '../prisma/db.js';
import type { CreateConversationDto } from './dto/create-conversation.dto.js';
import type {
  CreateMessageDto,
  CreateMessageAttachmentDto,
} from './dto/create-message.dto.js';
import type { MessageHistoryQueryDto } from './dto/message-history-query.dto.js';
import { AttachmentService } from './attachment.service.js';
import { MessageDeliveryService } from './message-delivery.service.js';
import { MESSAGE_CREATED_EVENT } from './message-realtime.event.js';
import { NotificationDomainEventService } from '../notifications/notification-domain-event.service.js';

const MESSAGE_TYPES = ['TEXT', 'IMAGE', 'FILE', 'VOICE', 'LOCATION'] as const;

type MessageType = (typeof MESSAGE_TYPES)[number];

type Member = {
  userId: string;
  createdAt: string;
};

function normalizeMessageType(type: string): MessageType {
  if (!MESSAGE_TYPES.includes(type as MessageType)) {
    throw new BadRequestException('Invalid message type');
  }
  return type as MessageType;
}

function validateMessagePayload(dto: CreateMessageDto) {
  const type = normalizeMessageType(dto.type);
  const attachments = dto.attachments ?? [];
  const hasAttachment = attachments.length > 0;
  const hasLocation = dto.location !== undefined;
  const hasContent = dto.content !== undefined && dto.content.trim().length > 0;

  if (type === 'TEXT' && (!hasContent || hasAttachment || hasLocation)) {
    throw new BadRequestException('TEXT messages require content and cannot contain attachments or location');
  }
  if (type === 'IMAGE' && (!hasAttachment || hasLocation)) {
    throw new BadRequestException('IMAGE messages require an attachment and cannot contain location');
  }
  if (type === 'FILE' && (!hasAttachment || hasLocation)) {
    throw new BadRequestException('FILE messages require an attachment and cannot contain location');
  }
  if (type === 'VOICE' && (!hasAttachment || hasLocation)) {
    throw new BadRequestException('VOICE messages require a voice attachment and cannot contain location');
  }
  if (type === 'LOCATION' && (!hasLocation || hasAttachment)) {
    throw new BadRequestException('LOCATION messages require a location and cannot contain attachments');
  }

  if (hasAttachment) {
    if (attachments.length !== 1) {
      throw new BadRequestException('A message may contain at most one attachment in Step 5.2');
    }
    const attachment = attachments[0];
    if (!attachment.originalFilename?.trim()) {
      throw new BadRequestException('Attachment filename is required');
    }
    if (type === 'VOICE' && !attachment.mimeType.toLowerCase().startsWith('audio/')) {
      throw new BadRequestException('VOICE messages require an audio attachment');
    }
  }

  if (dto.location) {
    if (dto.location.expiresAt && new Date(dto.location.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('Location expiry must be in the future');
    }
  }

  return { type, attachment: attachments[0], location: dto.location };
}

@Injectable()
export class MessagingService {
  constructor(
    private readonly messageDeliveryService: MessageDeliveryService,
    @Optional() private readonly attachmentService?: AttachmentService,
    @Optional() private readonly notificationDomainEventService?: NotificationDomainEventService,
  ) {}

  async createConversation(user: AuthenticatedUser, dto: CreateConversationDto) {
    const task = await db.orm.public.Task.where({ id: dto.taskId }).first();
    if (!task) throw new NotFoundException('Task not found');

    let contract = null;
    if (dto.contractId) {
      contract = await db.orm.public.Contract.where({ id: dto.contractId }).first();
      if (!contract) throw new NotFoundException('Contract not found');
      if (contract.taskId !== task.id) {
        throw new BadRequestException('Contract does not belong to the task');
      }
    } else {
      contract = await db.orm.public.Contract.where({ taskId: task.id }).first();
    }

    const members = new Set<string>();

    if (contract) {
      const isParticipant = user.userId === task.clientId || user.userId === contract.workerId;
      if (!isParticipant) throw new ForbiddenException('You are not authorised for this marketplace conversation');
      members.add(task.clientId);
      members.add(contract.workerId);
    } else {
      if (user.userId !== task.clientId) {
        const application = await db.orm.public.Application
          .where({ taskId: task.id, workerId: user.userId })
          .first();
        if (!application) throw new ForbiddenException('You are not an authorised participant for this task');
      }

      let participantId = dto.participantUserId;
      if (!participantId) {
        throw new BadRequestException('participantUserId is required when the task has no contract');
      }
      if (participantId === user.userId) {
        throw new BadRequestException('A conversation requires another marketplace participant');
      }

      const participantIsClient = participantId === task.clientId;
      const participantApplication = participantIsClient
        ? true
        : Boolean(await db.orm.public.Application.where({
            taskId: task.id,
            workerId: participantId,
          }).first());

      if (!participantIsClient && !participantApplication) {
        throw new ForbiddenException('The requested participant is not authorised for this task');
      }

      members.add(task.clientId);
      members.add(participantId);

      if (!members.has(user.userId)) {
        throw new ForbiddenException('You are not an authorised participant for this conversation');
      }
    }

    const memberIds = [...members];

    const existing = await db.orm.public.Conversation
      .where(contract ? { contractId: contract.id } : { taskId: task.id })
      .include('members', (member) => member.select('userId', 'createdAt'))
      .all();

    const reusable = existing.find((conversation) => {
      const existingIds = new Set((conversation.members as Member[]).map((member) => member.userId));
      return existingIds.size === memberIds.length && memberIds.every((id) => existingIds.has(id));
    });

    if (reusable) {
      return this.projectConversation(reusable);
    }

    return db.transaction(async (tx) => {
      const created = await tx.orm.public.Conversation.create({
        taskId: task.id,
        contractId: contract?.id ?? null,
      });

      for (const userId of memberIds) {
        await tx.orm.public.ConversationMember.create({
          conversationId: created.id,
          userId,
        });
      }

      return this.getConversationForUser(tx, created.id, user.userId);
    });
  }

  async listConversations(user: AuthenticatedUser) {
    const memberships = await db.orm.public.ConversationMember
      .where({ userId: user.userId })
      .all();

    const conversations = [];
    for (const membership of memberships) {
      const conversation = await this.getConversationForUser(db, membership.conversationId, user.userId);
      conversations.push(conversation);
    }

    return conversations.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async getConversation(user: AuthenticatedUser, conversationId: string) {
    return this.getConversationForUser(db, conversationId, user.userId);
  }

  async createMessage(user: AuthenticatedUser, conversationId: string, dto: CreateMessageDto) {
    const conversation = await db.orm.public.Conversation.where({ id: conversationId }).first();
    if (!conversation) throw new NotFoundException('Conversation not found');

    await this.requireMember(conversationId, user.userId);
    const payload = validateMessagePayload(dto);

    if (conversation.contractId) {
      const contract = await db.orm.public.Contract.where({ id: conversation.contractId }).first();
      if (!contract || contract.taskId !== conversation.taskId) {
        throw new BadRequestException('Conversation marketplace context is invalid');
      }
    }

    if (payload.attachment && !this.attachmentService) {
      throw new BadRequestException('Attachment storage service is not available');
    }

    const attachmentMetadata = payload.attachment
      ? this.attachmentService!.validateMetadata({
          type: payload.type as 'IMAGE' | 'FILE' | 'VOICE',
          originalFilename: payload.attachment.originalFilename,
          mimeType: payload.attachment.mimeType,
          size: payload.attachment.size,
          checksum: payload.attachment.checksum,
        })
      : null;
    const attachmentId = attachmentMetadata ? randomUUID() : null;
    const storageKey = attachmentId ? `attachments/${attachmentId}` : null;

    const message = await db.transaction(async (tx) => {
      const created = await tx.orm.public.Message.create({
        conversationId,
        senderId: user.userId,
        type: payload.type,
        content: dto.content?.trim() || null,
        fileUrl: null,
        fileName: null,
      });

      if (attachmentMetadata && attachmentId && storageKey) {
        await tx.orm.public.MessageAttachment.create({
          id: attachmentId,
          messageId: created.id,
          storageKey,
          originalFilename: attachmentMetadata.originalFilename,
          mimeType: attachmentMetadata.mimeType,
          size: BigInt(attachmentMetadata.size),
          checksum: attachmentMetadata.checksum,
          status: 'PENDING',
        });
      }

      if (payload.location) {
        await tx.orm.public.MessageLocation.create({
          messageId: created.id,
          latitude: String(payload.location.latitude),
          longitude: String(payload.location.longitude),
          accuracy: payload.location.accuracy === undefined ? null : String(payload.location.accuracy),
          expiresAt: payload.location.expiresAt ?? null,
        });
      }

      return this.getMessageForUser(tx, conversationId, created.id, user.userId);
    });

    let attachmentUpload = null;
    if (attachmentId && this.attachmentService) {
      attachmentUpload = await this.attachmentService.createUploadInstruction(
        user,
        conversationId,
        attachmentId,
      );
    }

    await this.notificationDomainEventService?.messageCreated(message.id);

    await this.messageDeliveryService.publishMessageCreated({
      eventType: MESSAGE_CREATED_EVENT,
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      type: message.type,
      content: message.content,
      attachments: message.attachments,
      location: message.location,
      createdAt: String(message.createdAt),
    });

    return { ...message, attachmentUpload };
  }

  async getMessages(user: AuthenticatedUser, conversationId: string, query: MessageHistoryQueryDto) {
    await this.requireMember(conversationId, user.userId);

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 100);
    const offset = (page - 1) * pageSize;

    const rows = await db.orm.public.Message
      .where({ conversationId })
      .include('attachments', (attachment: any) =>
        attachment.select('id', 'messageId', 'originalFilename', 'mimeType', 'size', 'checksum', 'status', 'createdAt'),
      )
      .include('location', (location: any) =>
        location.select('id', 'messageId', 'latitude', 'longitude', 'accuracy', 'expiresAt', 'createdAt'),
      )
      .orderBy([(message) => message.createdAt.asc(), (message) => message.id.asc()])
      .offset(offset)
      .limit(pageSize + 1)
      .all();

    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map((message) => this.projectMessage(message));

    return { items, page, pageSize, hasMore };
  }

  private async requireMember(conversationId: string, userId: string) {
    const member = await db.orm.public.ConversationMember
      .where({ conversationId, userId })
      .first();
    if (!member) throw new ForbiddenException('You are not a member of this conversation');
    return member;
  }

  private async getConversationForUser(client: any, conversationId: string, userId: string) {
    const member = await client.orm.public.ConversationMember
      .where({ conversationId, userId })
      .first();
    if (!member) throw new ForbiddenException('You are not a member of this conversation');

    const conversation = await client.orm.public.Conversation
      .where({ id: conversationId })
      .include('members', (item: any) => item.select('userId', 'createdAt'))
      .include('task', (item: any) => item.select('id', 'title', 'status'))
      .include('contract', (item: any) => item.select('id', 'taskId', 'workerId', 'status'))
      .first();

    if (!conversation) throw new NotFoundException('Conversation not found');
    return this.projectConversation(conversation);
  }

  private projectConversation(conversation: any) {
    return {
      id: conversation.id,
      task: conversation.task
        ? { id: conversation.task.id, title: conversation.task.title, status: conversation.task.status }
        : null,
      contract: conversation.contract
        ? {
            id: conversation.contract.id,
            taskId: conversation.contract.taskId,
            workerId: conversation.contract.workerId,
            status: conversation.contract.status,
          }
        : null,
      members: (conversation.members ?? []).map((member: Member) => ({
        userId: member.userId,
        createdAt: member.createdAt,
      })),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private async getMessageForUser(client: any, conversationId: string, messageId: string, userId: string) {
    const member = await client.orm.public.ConversationMember.where({ conversationId, userId }).first();
    if (!member) throw new ForbiddenException('You are not a member of this conversation');

    const message = await client.orm.public.Message
      .where({ id: messageId, conversationId })
      .include('attachments', (attachment: any) =>
        attachment.select('id', 'messageId', 'originalFilename', 'mimeType', 'size', 'checksum', 'status', 'createdAt'),
      )
      .include('location', (location: any) =>
        location.select('id', 'messageId', 'latitude', 'longitude', 'accuracy', 'expiresAt', 'createdAt'),
      )
      .first();

    if (!message) throw new NotFoundException('Message not found');
    return this.projectMessage(message);
  }

  private projectMessage(message: any) {
    const location = message.location;
    const expired = Boolean(location?.expiresAt && new Date(String(location.expiresAt)).getTime() <= Date.now());

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      type: message.type,
      content: message.content,
      attachments: (message.attachments ?? []).map((attachment: any) => ({
        id: attachment.id,
        messageId: attachment.messageId,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        size: String(attachment.size),
        checksum: attachment.checksum,
        status: attachment.status,
        createdAt: attachment.createdAt,
      })),
      location: location
        ? {
            id: location.id,
            messageId: location.messageId,
            latitude: expired ? null : location.latitude,
            longitude: expired ? null : location.longitude,
            accuracy: expired ? null : location.accuracy,
            expiresAt: location.expiresAt,
            createdAt: location.createdAt,
            expired,
          }
        : null,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }
}

export { validateMessagePayload };
