import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationController } from './notification.controller.js';
import { NotificationService } from './notification.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { InAppNotificationDeliveryProvider } from './in-app-notification-delivery.provider.js';
import { EmailNotificationDeliveryProvider } from './email-notification-delivery.provider.js';
import { PushNotificationDeliveryProvider } from './push-notification-delivery.provider.js';
import { NotificationDomainEventService } from './notification-domain-event.service.js';

@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationDeliveryService,
    InAppNotificationDeliveryProvider,
    EmailNotificationDeliveryProvider,
    PushNotificationDeliveryProvider,
    NotificationDomainEventService,
  ],
  exports: [NotificationService, NotificationDeliveryService, NotificationDomainEventService],
})
export class NotificationModule {}
