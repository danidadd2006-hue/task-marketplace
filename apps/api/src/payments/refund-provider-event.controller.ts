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
import { RefundProviderEventService } from './refund-provider-event.service.js';

@Controller('api/v1/payments')
export class RefundProviderEventController {
  constructor(
    private readonly refundProviderEventService: RefundProviderEventService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  @Post('refund-provider-events')
  async receiveProviderEvent(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const rawBody = request.rawBody?.toString('utf8');
    if (!rawBody) {
      throw new BadRequestException('Raw provider webhook body is required');
    }

    return this.refundProviderEventService.processWebhook({
      body,
      headers,
      rawBody,
      normalize: (input) => this.paymentProvider.normalizeRefundWebhook(input),
    });
  }
}
