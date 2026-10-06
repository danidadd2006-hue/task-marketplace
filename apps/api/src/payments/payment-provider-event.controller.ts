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
import { PaymentProviderEventService } from './payment-provider-event.service.js';

@Controller('api/v1/payments')
export class PaymentProviderEventController {
  constructor(
    private readonly paymentProviderEventService: PaymentProviderEventService,
  ) {}

  @Post('provider-events')
  receiveProviderEvent(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const rawBody = request.rawBody?.toString('utf8');

    if (!rawBody) {
      throw new BadRequestException('Raw provider webhook body is required');
    }

    return this.paymentProviderEventService.processWebhook({
      body,
      headers,
      rawBody,
    });
  }
}
