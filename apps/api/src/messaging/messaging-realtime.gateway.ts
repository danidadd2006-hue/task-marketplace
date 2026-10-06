import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { db } from '../prisma/db.js';
import type { AuthenticatedUser, UserRole } from '../auth/authenticated-user.js';
import { MessageDeliveryService } from './message-delivery.service.js';
import {
  MESSAGE_CREATED_EVENT,
  type MessageCreatedRealtimeEvent,
  type MessageDeliveryTransport,
} from './message-realtime.event.js';

type ConversationSubscription = {
  conversationId: string;
};

type SocketData = {
  user?: AuthenticatedUser;
  subscriptions?: Set<string>;
};

function extractAccessToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.replace(/^Bearer\s+/i, '').trim();
  }

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization === 'string' && authorization.trim()) {
    return authorization.replace(/^Bearer\s+/i, '').trim();
  }

  return null;
}

@Injectable()
@WebSocketGateway({
  namespace: '/messaging',
  transports: ['websocket'],
})
export class MessagingRealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, MessageDeliveryTransport
{
  private readonly logger = new Logger(MessagingRealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly messageDeliveryService: MessageDeliveryService,
  ) {}

  afterInit(server: Server): void {
    this.server = server;
    this.messageDeliveryService.registerTransport(this);
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = extractAccessToken(socket);
      if (!token) {
        throw new UnauthorizedException('Authentication required');
      }

      const payload = await this.jwtService.verifyAsync<{ sub: string; email: string }>(token);
      if (!payload.sub) {
        throw new UnauthorizedException('Invalid authentication token');
      }

      const user = await this.loadAuthenticatedUser(payload.sub);
      socket.data = {
        ...(socket.data ?? {}),
        user,
        subscriptions: new Set<string>(),
      } satisfies SocketData;
    } catch {
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    const subscriptions = (socket.data as SocketData | undefined)?.subscriptions;
    subscriptions?.clear();
  }

  @SubscribeMessage('conversation:subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: ConversationSubscription,
  ) {
    const user = await this.requireActiveUser(socket);
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim() : '';

    if (!conversationId) {
      throw new UnauthorizedException('Invalid conversation subscription');
    }

    const membership = await db.orm.public.ConversationMember
      .where({ conversationId, userId: user.userId })
      .first();

    if (!membership) {
      throw new ForbiddenException('Conversation subscription is not authorised');
    }

    const conversation = await db.orm.public.Conversation.where({ id: conversationId }).first();
    if (!conversation) {
      throw new ForbiddenException('Conversation subscription is not authorised');
    }

    const room = this.roomName(conversationId);
    await socket.join(room);
    const subscriptions = ((socket.data as SocketData).subscriptions ??= new Set<string>());
    subscriptions.add(conversationId);

    return { ok: true, conversationId };
  }

  async publishMessageCreated(event: MessageCreatedRealtimeEvent): Promise<void> {
    if (!this.server) {
      return;
    }

    const memberships = await db.orm.public.ConversationMember
      .where({ conversationId: event.conversationId })
      .all();

    if (memberships.length === 0) {
      return;
    }

    const room = this.roomName(event.conversationId);
    const sockets = await this.server.in(room).fetchSockets();

    for (const socket of sockets) {
      try {
        const user = await this.loadAuthenticatedUser(
          (socket.data as SocketData | undefined)?.user?.userId,
        );

        if (!memberships.some((member) => member.userId === user.userId)) {
          continue;
        }

        socket.emit(MESSAGE_CREATED_EVENT, event);
      } catch {
        socket.disconnect(true);
      }
    }
  }

  private async requireActiveUser(socket: Socket): Promise<AuthenticatedUser> {
    const userId = (socket.data as SocketData | undefined)?.user?.userId;
    const user = await this.loadAuthenticatedUser(userId);

    socket.data = {
      ...(socket.data ?? {}),
      user,
      subscriptions: (socket.data as SocketData | undefined)?.subscriptions ?? new Set<string>(),
    } satisfies SocketData;

    return user;
  }

  private async loadAuthenticatedUser(userId: string | undefined): Promise<AuthenticatedUser> {
    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await db.orm.public.User.where({ id: userId }).first();
    if (!user) {
      throw new UnauthorizedException('Authentication failed');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('User account is not active');
    }

    const assignments = await db.orm.public.UserRoleAssignment.where({ userId: user.id }).all();

    return {
      userId: user.id,
      email: user.email,
      roles: assignments.map((assignment) => assignment.role as UserRole),
    };
  }

  private roomName(conversationId: string): string {
    return `conversation:${conversationId}`;
  }
}
