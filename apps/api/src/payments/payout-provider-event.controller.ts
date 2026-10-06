import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider.js';
import { PayoutProviderEventService } from './payout-provider-event.service.js';

@Controller('api/v1/payments')
export class PayoutProviderEventController {
  constructor(
    private readonly payoutProviderEventService: PayoutProviderEventService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  @Post('payout-provider-events')
  async receiveProviderEvent(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const rawBody = request.rawBody?.toString('utf8');
    if (!rawBody) {
      throw new BadRequestException('Raw provider webhook body is required');
    }

    const event = await this.paymentProvider.normalizePayoutWebhook({
      body,
      headers,
      rawBody,
    });
    return this.payoutProviderEventService.processNormalizedEvent(event);
  }
}
