import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentFundingController } from './payment-funding.controller.js';
import { PaymentFundingService } from './payment-funding.service.js';
import { PaymentProviderEventController } from './payment-provider-event.controller.js';
import { PaymentProviderEventService } from './payment-provider-event.service.js';
import { PayoutFoundationService } from './payout-foundation.service.js';
import { PayoutProviderEventService } from './payout-provider-event.service.js';
import { PaymentReleaseController } from './payment-release.controller.js';
import { PayoutProviderEventController } from './payout-provider-event.controller.js';
import { PaymentReleaseService } from './payment-release.service.js';
import {
  PAYMENT_PROVIDER,
} from './payment-provider.js';
import { FlutterwavePaymentProvider } from './flutterwave-payment-provider.js';
import { PendingPaymentProvider } from './payment-provider.js';
import { RefundProviderService } from './refund-provider.service.js';
import { RefundProviderEventService } from './refund-provider-event.service.js';
import { RefundProviderEventController } from './refund-provider-event.controller.js';
import { RefundStateService } from './refund-state.service.js';
import { CancellationRefundAccountingService } from './cancellation-refund-accounting.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    PaymentFundingController,
    PaymentProviderEventController,
    PaymentReleaseController,
    PayoutProviderEventController,
    RefundProviderEventController,
  ],
  providers: [
    PaymentFundingService,
    PaymentProviderEventService,
    PayoutFoundationService,
    PayoutProviderEventService,
    PaymentReleaseService,
    RefundStateService,
    RefundProviderService,
    RefundProviderEventService,
    CancellationRefundAccountingService,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () =>
        process.env['PAYMENT_PROVIDER']?.toUpperCase() === 'FLUTTERWAVE'
          ? new FlutterwavePaymentProvider()
          : new PendingPaymentProvider(),
    },
  ],
  exports: [RefundProviderService, CancellationRefundAccountingService],
})
export class PaymentsModule {}
