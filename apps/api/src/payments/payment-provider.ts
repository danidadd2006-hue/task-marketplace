import { ServiceUnavailableException } from '@nestjs/common';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export class UnsupportedRefundProviderException extends ServiceUnavailableException {
  constructor() {
    super('Configured payment provider does not support refunds');
  }
}

export type PayoutDestinationReference = {
  provider: string;
  method: string;
  providerAccountRef: string;
};

export type NormalizedPaymentProviderEvent = {
  provider: string;
  providerEventId: string;
  type: 'FUNDING_SUCCEEDED' | 'FUNDING_FAILED' | 'FUNDING_CANCELLED';
  paymentId: string;
  providerRef: string | null;
  amount: string;
  currency: string;
  metadata: string | null;
  tokenPurchaseId?: string | null;
};

export type NormalizedRefundProviderResult = {
  provider: string;
  status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  providerRef: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  uncertaintyReason?: string | null;
  metadata?: string | null;
};

export type NormalizedRefundProviderEvent = {
  provider: string;
  providerEventId: string;
  type: 'REFUND_PROCESSING' | 'REFUND_SUCCEEDED' | 'REFUND_FAILED' | 'REFUND_UNKNOWN';
  providerRefundId: string | null;
  providerRef: string | null;
  paymentProviderRef: string | null;
  amount: string;
  currency: string;
  metadata: string | null;
};

export type NormalizedPayoutProviderEvent = {
  provider: string;
  providerEventId: string;
  type: 'PAYOUT_PROCESSING' | 'PAYOUT_SUCCEEDED' | 'PAYOUT_FAILED' | 'PAYOUT_UNKNOWN' | 'PAYOUT_CANCELLED';
  payoutId: string;
  providerRef: string | null;
  amount: string;
  currency: string;
  metadata: string | null;
};

export interface PaymentProvider {
  payoutProviderName?(): string | null;

  initiateFunding(input: {
    paymentId: string;
    amount: string;
    currency: string;
    customerEmail?: string;
  }): Promise<{
    status: 'PENDING';
    provider: string | null;
    providerRef: string | null;
    checkoutUrl: string | null;
  }>;

  initiateTokenPurchase(input: {
    purchaseId: string;
    amount: string;
    currency: string;
    customerEmail?: string;
    tokenAmount: number;
  }): Promise<{
    status: 'PENDING';
    provider: string | null;
    providerRef: string | null;
    checkoutUrl: string | null;
  }>;

  reconcileTokenPurchase(input: {
    purchaseId: string;
    providerRef?: string | null;
    amount: string;
    currency: string;
  }): Promise<
    | {
        status: 'FOUND';
        provider: string;
        providerRef: string;
        checkoutUrl: string | null;
      }
    | {
        status: 'NOT_FOUND';
      }
  >;

  reconcileFunding(input: {
    paymentId: string;
    providerRef?: string | null;
    amount: string;
    currency: string;
  }): Promise<
    | {
        status: 'FOUND';
        provider: string;
        providerRef: string;
        checkoutUrl: string | null;
      }
    | {
        status: 'NOT_FOUND';
      }
  >;

  normalizeWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody?: string;
  }): Promise<NormalizedPaymentProviderEvent>;

  initiateRefund(input: {
    refundId: string;
    paymentProviderRef: string;
    amount: string;
    currency: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<NormalizedRefundProviderResult>;

  reconcileRefund(input: {
    refundId: string;
    providerRef: string;
    amount: string;
    currency: string;
    metadata?: string | null;
  }): Promise<NormalizedRefundProviderResult>;

  normalizeRefundWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody?: string;
  }): Promise<NormalizedRefundProviderEvent>;

  initiatePayout(input: {
    payoutId: string;
    destination: PayoutDestinationReference;
    amount: string;
    currency: string;
  }): Promise<{
    status: 'PENDING' | 'PROCESSING';
    provider: string;
    providerRef: string;
  }>;

  reconcilePayout(input: {
    payoutId: string;
    providerRef: string;
    amount: string;
    currency: string;
  }): Promise<
    | { status: 'FOUND'; provider: string; providerRef: string }
    | { status: 'NOT_FOUND' }
  >;

  normalizePayoutWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody?: string;
  }): Promise<NormalizedPayoutProviderEvent>;
}

export class PendingPaymentProvider implements PaymentProvider {
  payoutProviderName(): string | null {
    return null;
  }

  async initiateTokenPurchase(): Promise<{
    status: 'PENDING';
    provider: string | null;
    providerRef: string | null;
    checkoutUrl: string | null;
  }> {
    throw new ServiceUnavailableException(
      'Payment provider token purchase initiation is not configured',
    );
  }

  async reconcileTokenPurchase(): Promise<
    | {
        status: 'FOUND';
        provider: string;
        providerRef: string;
        checkoutUrl: string | null;
      }
    | {
        status: 'NOT_FOUND';
      }
  > {
    return { status: 'NOT_FOUND' };
  }

  async initiateFunding(): Promise<{
    status: 'PENDING';
    provider: string | null;
    providerRef: string | null;
    checkoutUrl: string | null;
  }> {
    return {
      status: 'PENDING',
      provider: null,
      providerRef: null,
      checkoutUrl: null,
    };
  }

  async reconcileFunding(): Promise<
    | {
        status: 'FOUND';
        provider: string;
        providerRef: string;
        checkoutUrl: string | null;
      }
    | {
        status: 'NOT_FOUND';
      }
  > {
    return { status: 'NOT_FOUND' };
  }

  async normalizeWebhook(): Promise<NormalizedPaymentProviderEvent> {
    throw new ServiceUnavailableException(
      'Payment provider webhook verification is not configured',
    );
  }

  async initiateRefund(_input: {
    refundId: string;
    paymentProviderRef: string;
    amount: string;
    currency: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<NormalizedRefundProviderResult> {
    throw new UnsupportedRefundProviderException();
  }

  async reconcileRefund(_input: {
    refundId: string;
    providerRef: string;
    amount: string;
    currency: string;
    metadata?: string | null;
  }): Promise<NormalizedRefundProviderResult> {
    throw new UnsupportedRefundProviderException();
  }

  async normalizeRefundWebhook(_input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody?: string;
  }): Promise<NormalizedRefundProviderEvent> {
    throw new ServiceUnavailableException(
      'Payment provider refund webhook verification is not configured',
    );
  }

  async initiatePayout(_input: { payoutId: string; destination: PayoutDestinationReference; amount: string; currency: string }): Promise<{
    status: 'PENDING' | 'PROCESSING';
    provider: string;
    providerRef: string;
  }> {
    throw new ServiceUnavailableException(
      'Payment provider payout initiation is not configured',
    );
  }

  async reconcilePayout(_input: { payoutId: string; providerRef: string; amount: string; currency: string }): Promise<
    | { status: 'FOUND'; provider: string; providerRef: string }
    | { status: 'NOT_FOUND' }
  > {
    throw new ServiceUnavailableException(
      'Payment provider payout reconciliation is not configured',
    );
  }

  async normalizePayoutWebhook(_input: { body: unknown; headers: Record<string, string | string[] | undefined>; rawBody?: string }): Promise<NormalizedPayoutProviderEvent> {
    throw new ServiceUnavailableException(
      'Payment provider payout webhook verification is not configured',
    );
  }
}
