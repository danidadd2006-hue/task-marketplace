import { ServiceUnavailableException } from '@nestjs/common';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type NormalizedPaymentProviderEvent = {
  provider: string;
  providerEventId: string;
  type: 'FUNDING_SUCCEEDED' | 'FUNDING_FAILED' | 'FUNDING_CANCELLED';
  paymentId: string;
  providerRef: string | null;
  metadata: string | null;
};

export interface PaymentProvider {
  initiateFunding(input: {
    paymentId: string;
    amount: string;
    currency: string;
  }): Promise<{
    status: 'PENDING';
    provider: string | null;
    providerRef: string | null;
  }>;

  normalizeWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<NormalizedPaymentProviderEvent>;
}

export class PendingPaymentProvider implements PaymentProvider {
  async initiateFunding(): Promise<{
    status: 'PENDING';
    provider: string | null;
    providerRef: string | null;
  }> {
    return {
      status: 'PENDING',
      provider: null,
      providerRef: null,
    };
  }

  async normalizeWebhook(): Promise<NormalizedPaymentProviderEvent> {
    throw new ServiceUnavailableException(
      'Payment provider webhook verification is not configured',
    );
  }
}
