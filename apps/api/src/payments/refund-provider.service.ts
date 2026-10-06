import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { PAYMENT_PROVIDER, UnsupportedRefundProviderException, type PaymentProvider, type NormalizedRefundProviderResult } from './payment-provider.js';
import { RefundStateService } from './refund-state.service.js';

@Injectable()
export class RefundProviderService {
  constructor(
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    private readonly refundStateService: RefundStateService,
  ) {}

  async initiateForCancellation(cancellationId: string) {
    const intent = await db.transaction(async (tx) => {
      const cancellation = await tx.orm.public.Cancellation.where({ id: cancellationId }).first();
      if (!cancellation) throw new NotFoundException('Cancellation not found');

      if (cancellation.financialClassification === 'NO_FINANCIAL_ACTION') {
        return { kind: 'NO_REFUND' as const };
      }
      if (cancellation.clientRefund === '0') {
        return { kind: 'NO_REFUND' as const };
      }
      if (!cancellation.paymentId) {
        throw new ConflictException('Refundable cancellation has no payment');
      }

      const payment = await tx.orm.public.Payment.where({ id: cancellation.paymentId }).first();
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status === 'RELEASED') {
        throw new ConflictException('Released payments cannot be refunded through ordinary cancellation');
      }
      if (payment.status !== 'FUNDED') {
        throw new ConflictException('Only FUNDED payments are eligible for cancellation refunds');
      }
      if (payment.amount !== cancellation.fundedAmount || payment.currency.toUpperCase() !== cancellation.currency.toUpperCase()) {
        throw new ConflictException('Cancellation financial data does not match the authoritative payment');
      }
      if (!payment.providerRef) {
        throw new ConflictException('Funded payment has no provider reference for refund initiation');
      }

      const expectedAmount = cancellation.clientRefund;
      const idempotencyKey = 'refund:cancellation:' + cancellation.id;
      let refund = await tx.orm.public.Refund.where({ cancellationId }).first();

      if (!refund) {
        try {
          refund = await tx.orm.public.Refund.create({
            paymentId: payment.id,
            cancellationId: cancellation.id,
            amount: expectedAmount,
            currency: cancellation.currency,
            type: cancellation.financialClassification === 'FULL_REFUND' ? 'FULL' : 'PARTIAL',
            status: 'PENDING',
            idempotencyKey,
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          if ((error as { sqlState?: string })?.sqlState === '23505') {
            refund = await tx.orm.public.Refund.where({ cancellationId }).first();
            if (!refund) throw new ConflictException('Refund intent was created concurrently');
          } else {
            throw error;
          }
        }
      }

      if (
        refund.paymentId !== payment.id ||
        refund.cancellationId !== cancellation.id ||
        refund.amount !== expectedAmount ||
        refund.currency.toUpperCase() !== cancellation.currency.toUpperCase() ||
        refund.idempotencyKey !== idempotencyKey
      ) {
        throw new ConflictException('Existing refund does not match the authoritative cancellation');
      }

      if (refund.status === 'SUCCEEDED' || refund.status === 'PROCESSING' || refund.status === 'UNKNOWN' || refund.status === 'FAILED') {
        return { kind: 'EXISTING' as const, refund, paymentProviderRef: payment.providerRef };
      }

      return {
        kind: 'CLAIMABLE' as const,
        refundId: refund.id,
        paymentId: payment.id,
        paymentProviderRef: payment.providerRef,
        amount: expectedAmount,
        currency: cancellation.currency,
        idempotencyKey,
      };
    });

    if (intent.kind === 'NO_REFUND') return null;
    if (intent.kind === 'EXISTING') return this.publicResult(intent.refund);

    const claim = await this.refundStateService.transition(intent.refundId, 'PROCESSING');
    if (claim.idempotent) {
      const current = await db.orm.public.Refund.where({ id: intent.refundId }).first();
      return this.publicResult(current);
    }

    let result: NormalizedRefundProviderResult;
    try {
      result = await this.paymentProvider.initiateRefund({
        refundId: intent.refundId,
        paymentProviderRef: intent.paymentProviderRef,
        amount: intent.amount,
        currency: intent.currency,
        idempotencyKey: intent.idempotencyKey,
        metadata: { paymentId: intent.paymentId, cancellationId },
      });
    } catch (error) {
      if (error instanceof UnsupportedRefundProviderException) {
        await this.refundStateService.transition(intent.refundId, 'FAILED', {
          failureCode: 'UNSUPPORTED_PROVIDER',
          failureMessage: 'Refund provider is not available for this payment',
        });
        throw error;
      }
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException) {
        await this.refundStateService.transition(intent.refundId, 'FAILED', {
          failureMessage: error.message,
        });
        throw error;
      }
      if (error instanceof ServiceUnavailableException) {
        await this.refundStateService.transition(intent.refundId, 'UNKNOWN', {
          uncertaintyReason: 'Provider refund initiation outcome is uncertain',
        });
        throw new ServiceUnavailableException('Refund initiation outcome is uncertain; reconciliation is required');
      }
      await this.refundStateService.transition(intent.refundId, 'UNKNOWN', {
        uncertaintyReason: 'Provider refund initiation returned an uncertain outcome',
      });
      throw new ServiceUnavailableException('Refund initiation outcome is uncertain; reconciliation is required');
    }

    const transition = await this.refundStateService.transition(intent.refundId, result.status, {
      provider: result.provider,
      providerRef: result.providerRef,
      failureCode: result.failureCode,
      failureMessage: result.failureMessage,
      uncertaintyReason: result.uncertaintyReason,
      metadata: result.metadata,
    });
    return transition;
  }

  private publicResult(refund: {
    id: string;
    cancellationId: string;
    paymentId: string;
    amount: string;
    currency: string;
    type: string;
    status: string;
    initiatedAt?: string | null;
    succeededAt?: string | null;
  } | null) {
    if (!refund) return null;
    return {
      id: refund.id,
      cancellationId: refund.cancellationId,
      paymentId: refund.paymentId,
      amount: refund.amount,
      currency: refund.currency,
      type: refund.type,
      status: refund.status,
      initiatedAt: refund.initiatedAt ?? null,
      succeededAt: refund.succeededAt ?? null,
    };
  }
}
