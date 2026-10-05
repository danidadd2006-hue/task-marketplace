import { describe, expect, it, vi } from 'vitest';
import { PaymentFundingController } from './payment-funding.controller.js';

describe('PaymentFundingController', () => {
  it('accepts only task id and authenticated user context', async () => {
    const service = {
      initiateFunding: vi.fn().mockResolvedValue({ payment: { status: 'PENDING' } }),
    };
    const controller = new PaymentFundingController(service as never);
    const user = {
      userId: 'client-id',
      email: 'client@example.com',
      roles: ['CLIENT'] as const,
    };

    await controller.initiateFunding(
      { user },
      'task-id',
    );

    expect(service.initiateFunding).toHaveBeenCalledWith(user, 'task-id');
    expect(service.initiateFunding).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
