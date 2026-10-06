import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { MessageHistoryQueryDto } from './dto/message-history-query.dto.js';
import { AttachmentService } from './attachment.service.js';
import { MessagingService } from './messaging.service.js';

@Controller('api/v1/conversations')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly attachmentService: AttachmentService,
  ) {}

  @Post()
  createConversation(
    @Req() request: { user: AuthenticatedUser },
    @Body() body: CreateConversationDto,
  ) {
    return this.messagingService.createConversation(request.user, body);
  }

  @Get()
  listConversations(@Req() request: { user: AuthenticatedUser }) {
    return this.messagingService.listConversations(request.user);
  }

  @Get(':conversationId')
  getConversation(
    @Req() request: { user: AuthenticatedUser },
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagingService.getConversation(request.user, conversationId);
  }

  @Post(':conversationId/attachments/:attachmentId')
  createAttachmentUpload(
    @Req() request: { user: AuthenticatedUser },
    @Param('conversationId') conversationId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachmentService.createUploadInstruction(request.user, conversationId, attachmentId);
  }

  @Post(':conversationId/attachments/:attachmentId/complete')
  completeAttachmentUpload(
    @Req() request: { user: AuthenticatedUser },
    @Param('conversationId') conversationId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachmentService.completeUpload(request.user, conversationId, attachmentId);
  }

  @Get(':conversationId/attachments/:attachmentId')
  getAttachmentAccess(
    @Req() request: { user: AuthenticatedUser },
    @Param('conversationId') conversationId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachmentService.getAccess(request.user, conversationId, attachmentId);
  }

  @Post(':conversationId/messages')
  createMessage(
    @Req() request: { user: AuthenticatedUser },
    @Param('conversationId') conversationId: string,
    @Body() body: CreateMessageDto,
  ) {
    return this.messagingService.createMessage(request.user, conversationId, body);
  }

  @Get(':conversationId/messages')
  getMessages(
    @Req() request: { user: AuthenticatedUser },
    @Param('conversationId') conversationId: string,
    @Query() query: MessageHistoryQueryDto,
  ) {
    return this.messagingService.getMessages(request.user, conversationId, query);
  }
}
