import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { db, type Tx } from '../prisma/db.js';
import { NotificationDomainEventService } from '../notifications/notification-domain-event.service.js';
import { PaymentReleaseService } from './payment-release.service.js';
import type { NormalizedPayoutProviderEvent } from './payment-provider.js';

@Injectable()
export class PayoutProviderEventService {
  constructor(
    private readonly paymentReleaseService: PaymentReleaseService,
    @Optional() private readonly notificationDomainEventService?: NotificationDomainEventService,
  ) {}

  async processNormalizedEvent(event: NormalizedPayoutProviderEvent) {
    const result = await db.transaction(async (tx) => {
      const existing = await tx.orm.public.PayoutProviderEvent.where({
        provider: event.provider,
        providerEventId: event.providerEventId,
      }).first();
      if (existing) {
        return { status: 'DUPLICATE' as const, eventId: existing.id, payoutId: existing.payoutId };
      }

      const payout = await tx.orm.public.Payout.where({ id: event.payoutId }).first();
      if (!payout) throw new NotFoundException('Payout not found');
      if (payout.provider && payout.provider !== event.provider) {
        throw new BadRequestException('Payout provider does not match the event');
      }
      if (payout.amount !== event.amount || payout.currency.toUpperCase() !== event.currency.trim().toUpperCase()) {
        throw new ConflictException('Payout event amount or currency does not match the payout');
      }
      if (payout.providerRef && event.providerRef && payout.providerRef !== event.providerRef) {
        throw new BadRequestException('Payout provider reference does not match the event');
      }

      let recorded;
      try {
        recorded = await tx.orm.public.PayoutProviderEvent.create({
          provider: event.provider,
          providerEventId: event.providerEventId,
          type: event.type,
          payoutId: payout.id,
          providerRef: event.providerRef,
          metadata: event.metadata,
        });
      } catch (error) {
        if ((error as { sqlState?: string })?.sqlState === '23505') {
          const duplicate = await tx.orm.public.PayoutProviderEvent.where({
            provider: event.provider,
            providerEventId: event.providerEventId,
          }).first();
          if (duplicate) {
            return { status: 'DUPLICATE' as const, eventId: duplicate.id, payoutId: duplicate.payoutId };
          }
        }
        throw error;
      }

      const result = await this.paymentReleaseService.applyProviderEvent(event, tx);
      return {
        status: 'PROCESSED' as const,
        eventId: recorded.id,
        payoutId: payout.id,
        paymentId: payout.paymentId,
        payoutStatus: result?.status ?? null,
      };
    });

    if (result.payoutStatus === 'SUCCEEDED' && result.paymentId) {
      await this.notificationDomainEventService?.paymentReleased(result.paymentId);
    }

    return result;
  }

  async processWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }) {
    throw new NotFoundException('Payout webhook routing must be selected through the configured provider adapter');
  }
}
