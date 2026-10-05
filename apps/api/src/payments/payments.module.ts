import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentFundingController } from './payment-funding.controller.js';
import { PaymentFundingService } from './payment-funding.service.js';
import { PaymentProviderEventController } from './payment-provider-event.controller.js';
import { PaymentProviderEventService } from './payment-provider-event.service.js';
import {
  PAYMENT_PROVIDER,
  PendingPaymentProvider,
} from './payment-provider.js';

@Module({
  imports: [AuthModule],
  controllers: [PaymentFundingController, PaymentProviderEventController],
  providers: [
    PaymentFundingService,
    PaymentProviderEventService,
    {
      provide: PAYMENT_PROVIDER,
      useClass: PendingPaymentProvider,
    },
  ],
})
export class PaymentsModule {}
