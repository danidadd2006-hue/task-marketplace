import { Body, Controller, Headers, Post } from '@nestjs/common';
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
  ) {
    return this.paymentProviderEventService.processWebhook({ body, headers });
  }
}
