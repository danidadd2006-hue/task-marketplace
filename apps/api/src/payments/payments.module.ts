import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentFundingController } from './payment-funding.controller.js';
import { PaymentFundingService } from './payment-funding.service.js';
import {
  PAYMENT_PROVIDER,
  PendingPaymentProvider,
} from './payment-provider.js';

@Module({
  imports: [AuthModule],
  controllers: [PaymentFundingController],
  providers: [
    PaymentFundingService,
    {
      provide: PAYMENT_PROVIDER,
      useClass: PendingPaymentProvider,
    },
  ],
})
export class PaymentsModule {}
