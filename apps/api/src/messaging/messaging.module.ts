import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AttachmentStorageModule } from './attachment-storage.module.js';
import { MessagingController } from './messaging.controller.js';
import { MessageDeliveryService } from './message-delivery.service.js';
import { MessagingRealtimeGateway } from './messaging-realtime.gateway.js';
import { MessagingService } from './messaging.service.js';
import { NotificationModule } from '../notifications/notification.module.js';

@Module({
  imports: [AuthModule, AttachmentStorageModule, NotificationModule],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    MessageDeliveryService,
    MessagingRealtimeGateway,
  ],
  exports: [MessagingService, MessageDeliveryService],
})
export class MessagingModule {}
