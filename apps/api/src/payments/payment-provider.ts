import { ServiceUnavailableException } from '@nestjs/common';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type NormalizedPaymentProviderEvent = {
  provider: string;
  providerEventId: string;
  type: 'FUNDING_SUCCEEDED' | 'FUNDING_FAILED' | 'FUNDING_CANCELLED';
  paymentId: string;
  providerRef: string | null;
  amount: string;
  currency: string;
  metadata: string | null;
};

export interface PaymentProvider {
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
}

export class PendingPaymentProvider implements PaymentProvider {
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
}
