import type { NotificationChannel, NotificationType } from './notification.service.js';

export type NotificationDeliveryOutcomeStatus = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export type NotificationDeliveryFailureClass =
  | 'PERMANENT_FAILURE'
  | 'TRANSIENT_FAILURE'
  | 'UNKNOWN'
  | 'SUPPRESSED'
  | 'NO_DESTINATION';

export interface NotificationDeliveryNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  deepLink: string | null;
}

export type NotificationDeliveryInstructions =
  | {
      channel: 'IN_APP';
      notification: NotificationDeliveryNotification;
    }
  | {
      channel: 'EMAIL';
      notification: NotificationDeliveryNotification;
      recipient: {
        userId: string;
        email: string;
      };
    }
  | {
      channel: 'PUSH';
      notification: NotificationDeliveryNotification;
      devices: readonly {
        id: string;
        provider: string;
        platform: string;
      }[];
    };

export interface NotificationDeliveryOutcome {
  status: NotificationDeliveryOutcomeStatus;
  provider?: string;
  providerRef?: string;
  providerOutcome?: string;
  errorClass?: string;
  uncertaintyInfo?: string;
}

export interface NotificationDeliveryProvider {
  readonly channel: NotificationChannel;
  deliver(
    notification: NotificationDeliveryNotification,
    instructions: NotificationDeliveryInstructions,
  ): Promise<NotificationDeliveryOutcome>;
}
