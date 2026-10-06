import { Injectable } from '@nestjs/common';
import type {
  NotificationDeliveryInstructions,
  NotificationDeliveryNotification,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
} from './notification-delivery.provider.js';

@Injectable()
export class EmailNotificationDeliveryProvider implements NotificationDeliveryProvider {
  readonly channel = 'EMAIL' as const;

  async deliver(
    notification: NotificationDeliveryNotification,
    instructions: NotificationDeliveryInstructions,
  ): Promise<NotificationDeliveryOutcome> {
    if (instructions.channel !== 'EMAIL' || instructions.notification.id !== notification.id) {
      return {
        status: 'FAILED',
        provider: 'local.email.noop',
        providerOutcome: 'invalid_email_delivery_instruction',
        errorClass: 'INVALID_INSTRUCTION',
      };
    }

    if (!instructions.recipient.email.trim()) {
      return {
        status: 'FAILED',
        provider: 'local.email.noop',
        providerOutcome: 'missing_authoritative_email',
        errorClass: 'NO_DESTINATION',
      };
    }

    return {
      status: 'UNKNOWN',
      provider: 'local.email.noop',
      providerOutcome: 'external_provider_deferred',
      uncertaintyInfo: 'No external email provider is configured; no email was sent.',
    };
  }
}
