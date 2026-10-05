export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

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
}
