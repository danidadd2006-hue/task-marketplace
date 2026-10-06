import { Injectable } from '@nestjs/common';
import type {
  NotificationDeliveryInstructions,
  NotificationDeliveryNotification,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
} from './notification-delivery.provider.js';

@Injectable()
export class InAppNotificationDeliveryProvider implements NotificationDeliveryProvider {
  readonly channel = 'IN_APP' as const;

  async deliver(
    notification: NotificationDeliveryNotification,
    instructions: NotificationDeliveryInstructions,
  ): Promise<NotificationDeliveryOutcome> {
    if (instructions.channel !== 'IN_APP' || instructions.notification.id !== notification.id) {
      return {
        status: 'FAILED',
        provider: 'local.in-app',
        providerOutcome: 'invalid_in_app_delivery_instruction',
        errorClass: 'INVALID_INSTRUCTION',
      };
    }

    return {
      status: 'SUCCEEDED',
      provider: 'local.in-app',
      providerOutcome: 'persistence_available',
    };
  }
}
