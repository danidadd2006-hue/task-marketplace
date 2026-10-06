export const MESSAGE_CREATED_EVENT = 'MESSAGE_CREATED' as const;

export interface MessageRealtimeAttachment {
  id: string;
  messageId: string;
  originalFilename: string | null;
  mimeType: string;
  size: string;
  checksum: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  createdAt: string;
}

export interface MessageRealtimeLocation {
  id: string;
  messageId: string;
  latitude: string | null;
  longitude: string | null;
  accuracy: string | null;
  expiresAt: string | null;
  createdAt: string;
  expired: boolean;
}

export interface MessageCreatedRealtimeEvent {
  eventType: typeof MESSAGE_CREATED_EVENT;
  messageId: string;
  conversationId: string;
  senderId: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE' | 'LOCATION';
  content: string | null;
  attachments: MessageRealtimeAttachment[];
  location: MessageRealtimeLocation | null;
  createdAt: string;
}

export interface MessageDeliveryTransport {
  publishMessageCreated(event: MessageCreatedRealtimeEvent): Promise<void>;
}
