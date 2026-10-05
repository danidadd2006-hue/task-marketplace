import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  NormalizedPaymentProviderEvent,
  PaymentProvider,
} from './payment-provider.js';

const PROVIDER = 'FLUTTERWAVE';
const API_BASE_URL = 'https://api.flutterwave.com/v3';

type FlutterwaveResponse = {
  status?: string;
  message?: string;
  data?: {
    id?: number | string;
    link?: string;
    tx_ref?: string;
    flw_ref?: string;
    status?: string;
    amount?: number | string;
    currency?: string;
  };
};

export class FlutterwavePaymentProvider implements PaymentProvider {
  async initiateFunding(input: {
    paymentId: string;
    amount: string;
    currency: string;
    customerEmail?: string;
  }) {
    const secretKey = process.env['FLUTTERWAVE_SECRET_KEY'];
    const redirectUrl = process.env['FLUTTERWAVE_REDIRECT_URL'];

    if (!secretKey || !redirectUrl) {
      throw new ServiceUnavailableException(
        'Flutterwave payment configuration is not available',
      );
    }

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Funding amount is not valid for Flutterwave');
    }
    if (!input.customerEmail) {
      throw new BadRequestException('Customer email is required for Flutterwave checkout');
    }

    const response = await fetch(`${API_BASE_URL}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        tx_ref: input.paymentId,
        currency: input.currency,
        redirect_url: redirectUrl,
        payment_options: 'card, mpesa, banktransfer, account',
        customer: {
          email: input.customerEmail,
        },
        meta: {
          payment_id: input.paymentId,
        },
      }),
    });

    const payload = await this.parseResponse(response);

    if (!response.ok || payload.status !== 'success' || !payload.data?.link) {
      throw new ServiceUnavailableException(
        payload.message || 'Flutterwave checkout could not be created',
      );
    }

    return {
      status: 'PENDING' as const,
      provider: PROVIDER,
      providerRef: payload.data.tx_ref ?? input.paymentId,
      checkoutUrl: payload.data.link,
    };
  }

  async normalizeWebhook(input: {
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    rawBody?: string;
  }): Promise<NormalizedPaymentProviderEvent> {
    const secretHash = process.env['FLUTTERWAVE_WEBHOOK_SECRET_HASH'];
    if (!secretHash || !input.rawBody) {
      throw new ServiceUnavailableException(
        'Flutterwave webhook verification is not configured',
      );
    }

    const signature = this.headerValue(input.headers['flutterwave-signature']);
    if (!signature || !this.isValidSignature(input.rawBody, signature, secretHash)) {
      throw new BadRequestException('Invalid Flutterwave webhook signature');
    }

    const body = this.object(input.body);
    const data = this.object(body['data']);
    const txRef = this.stringValue(data['tx_ref']);

    if (!txRef) {
      throw new BadRequestException('Flutterwave webhook has no transaction reference');
    }

    const verification = await this.verifyByReference(txRef);
    const verified = this.object(verification['data']);

    const verifiedTxRef = this.stringValue(verified['tx_ref']);
    const status = this.stringValue(verified['status'])?.toLowerCase();
    const providerEventId =
      this.stringValue(body['id']) ||
      this.stringValue(body['webhook_id']) ||
      this.stringValue(data['id']);

    if (!providerEventId || !verifiedTxRef || verifiedTxRef !== txRef) {
      throw new BadRequestException('Flutterwave transaction reference could not be verified');
    }

    let type: NormalizedPaymentProviderEvent['type'];
    if (status === 'successful') {
      type = 'FUNDING_SUCCEEDED';
    } else if (status === 'failed') {
      type = 'FUNDING_FAILED';
    } else if (status === 'cancelled' || status === 'canceled') {
      type = 'FUNDING_CANCELLED';
    } else {
      throw new BadRequestException('Flutterwave webhook is not a terminal payment event');
    }

    return {
      provider: PROVIDER,
      providerEventId,
      type,
      paymentId: txRef,
      providerRef:
        this.stringValue(verified['flw_ref']) ||
        this.stringValue(verified['id']),
      amount: this.stringValue(verified['amount']) ?? '',
      currency: this.stringValue(verified['currency']) ?? '',
      metadata: JSON.stringify({
        providerStatus: status,
        transactionId: verified['id'] ?? null,
        amount: verified['amount'] ?? null,
        currency: verified['currency'] ?? null,
      }),
    };
  }

  private async verifyByReference(txRef: string): Promise<Record<string, unknown>> {
    const secretKey = process.env['FLUTTERWAVE_SECRET_KEY'];
    if (!secretKey) {
      throw new ServiceUnavailableException(
        'Flutterwave payment configuration is not available',
      );
    }

    const url = new URL(`${API_BASE_URL}/transactions/verify_by_reference`);
    url.searchParams.set('tx_ref', txRef);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: 'application/json',
      },
    });

    const payload = await this.parseResponse(response);
    if (!response.ok || payload.status !== 'success' || !payload.data) {
      throw new ServiceUnavailableException(
        payload.message || 'Flutterwave transaction verification failed',
      );
    }

    return payload as Record<string, unknown>;
  }

  private async parseResponse(response: Response): Promise<FlutterwaveResponse> {
    try {
      return (await response.json()) as FlutterwaveResponse;
    } catch {
      throw new ServiceUnavailableException('Flutterwave returned an invalid response');
    }
  }

  private headerValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private isValidSignature(rawBody: string, signature: string, secretHash: string) {
    const expected = createHmac('sha256', secretHash)
      .update(rawBody)
      .digest('base64');
    const actual = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return (
      actual.length === expectedBuffer.length &&
      timingSafeEqual(actual, expectedBuffer)
    );
  }

  private object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : undefined;
  }
}
