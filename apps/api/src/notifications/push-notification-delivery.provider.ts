import { Injectable } from '@nestjs/common';
import type {
  NotificationDeliveryInstructions,
  NotificationDeliveryNotification,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
} from './notification-delivery.provider.js';

@Injectable()
export class PushNotificationDeliveryProvider implements NotificationDeliveryProvider {
  readonly channel = 'PUSH' as const;

  async deliver(
    notification: NotificationDeliveryNotification,
    instructions: NotificationDeliveryInstructions,
  ): Promise<NotificationDeliveryOutcome> {
    if (instructions.channel !== 'PUSH' || instructions.notification.id !== notification.id) {
      return {
        status: 'FAILED',
        provider: 'local.push.noop',
        providerOutcome: 'invalid_push_delivery_instruction',
        errorClass: 'INVALID_INSTRUCTION',
      };
    }

    if (instructions.devices.length === 0) {
      return {
        status: 'FAILED',
        provider: 'local.push.noop',
        providerOutcome: 'no_active_push_device',
        errorClass: 'NO_DESTINATION',
      };
    }

    return {
      status: 'UNKNOWN',
      provider: 'local.push.noop',
      providerOutcome: 'external_provider_deferred',
      uncertaintyInfo: 'No external push provider is configured; no push was sent.',
    };
  }
}
