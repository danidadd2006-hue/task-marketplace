import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentReleaseService } from './payment-release.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  payoutDbWhere: vi.fn(),
  provider: {
    payoutProviderName: vi.fn(),
    initiatePayout: vi.fn(),
    reconcilePayout: vi.fn(),
  },
  paymentWhere: vi.fn(),
  taskWhere: vi.fn(),
  contractWhere: vi.fn(),
  destinationWhere: vi.fn(),
  payoutWhere: vi.fn(),
  payoutCreate: vi.fn(),
  ledgerWhere: vi.fn(),
  ledgerCreate: vi.fn(),
  auditCreate: vi.fn(),
  notificationPaymentReleased: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({
  db: {
    transaction: mocks.transaction,
    orm: { public: { Payout: { where: mocks.payoutDbWhere } } },
  },
}));
vi.mock('./payment-provider.js', () => ({ PAYMENT_PROVIDER: Symbol('PAYMENT_PROVIDER') }));

const client = { userId: 'client-1', email: 'client@example.com', status: 'ACTIVE', roles: ['CLIENT'] } as any;
const payment = {
  id: 'payment-1', taskId: 'task-1', clientId: 'client-1', workerId: 'worker-1',
  contractId: 'contract-1', amount: '100.00', currency: 'KES', status: 'FUNDED',
  provider: 'TEST', providerRef: 'fund-ref',
};
const task = { id: 'task-1', clientId: 'client-1', status: 'COMPLETED', currency: 'KES' };
const contract = { id: 'contract-1', taskId: 'task-1', workerId: 'worker-1', status: 'COMPLETED', agreedPrice: '100.00' };
const destination = { id: 'dest-1', userId: 'worker-1', provider: 'TEST', method: 'BANK', providerAccountRef: 'acct-secret', status: 'VERIFIED' };
const commission = { id: 'commission-1', paymentId: 'payment-1', type: 'COMMISSION', amount: '10.00', currency: 'KES' };
const payout = {
  id: 'payout-1', paymentId: 'payment-1', contractId: 'contract-1', taskId: 'task-1',
  workerId: 'worker-1', payoutDestinationId: 'dest-1', amount: '90.00', currency: 'KES',
  provider: null, providerRef: null, status: 'PENDING',
};

function tx() {
  return {
    orm: { public: {
      Task: { where: mocks.taskWhere },
      Contract: { where: mocks.contractWhere },
      PayoutDestination: { where: mocks.destinationWhere },
      Payout: { where: mocks.payoutWhere, create: mocks.payoutCreate },
      LedgerEntry: { where: mocks.ledgerWhere, create: mocks.ledgerCreate },
      Payment: { where: mocks.paymentWhere },
      AuditLog: { create: mocks.auditCreate },
    } },
  } as any;
}

let currentService: PaymentReleaseService | undefined;

function setup() {
  vi.resetAllMocks();
  currentService = undefined;
  mocks.provider.payoutProviderName.mockReturnValue('TEST');
  mocks.provider.initiatePayout.mockResolvedValue({ status: 'PROCESSING', provider: 'TEST', providerRef: 'payout-ref' });
  mocks.provider.reconcilePayout.mockResolvedValue({ status: 'FOUND', provider: 'TEST', providerRef: 'payout-ref' });
  mocks.payoutDbWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(payout) });
  mocks.transaction.mockImplementation(async (callback) => callback(tx()));
  mocks.taskWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(task) });
  mocks.contractWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(contract) });
  mocks.destinationWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(destination) });
  mocks.payoutWhere.mockImplementation((where: { paymentId?: string; id?: string }) => ({
    first: vi.fn().mockResolvedValue(where.paymentId ? undefined : payout),
    update: vi.fn().mockResolvedValue(1),
  }));
  mocks.paymentWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(payment), update: vi.fn().mockResolvedValue(1) });
  mocks.payoutCreate.mockResolvedValue(payout);
  mocks.ledgerWhere.mockImplementation((where: { type: string }) => ({
    first: vi.fn().mockResolvedValue(where.type === 'COMMISSION' ? commission : undefined),
  }));
  mocks.ledgerCreate.mockResolvedValue({ id: 'release-1' });
  mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
  mocks.notificationPaymentReleased.mockResolvedValue(undefined);
}

function service() {
  if (!currentService) {
    currentService = new PaymentReleaseService(
      mocks.provider as any,
      { paymentReleased: mocks.notificationPaymentReleased } as any,
    );
    (currentService as any).lockPayment = vi.fn().mockResolvedValue(payment);
  }
  return currentService;
}

describe('PaymentReleaseService — Step 4.3C', () => {
  beforeEach(setup);

  it('requires CLIENT authorization', async () => {
    await expect(service().releasePayment({ ...client, roles: ['WORKER'] }, 'payment-1', 'dest-1')).rejects.toThrow('CLIENT role required');
  });

  it('rejects a missing payment', async () => {
    (service() as any).lockPayment.mockResolvedValueOnce(null);
    await expect(service().releasePayment(client, 'missing', 'dest-1')).rejects.toThrow('Payment not found');
  });

  it('rejects another client', async () => {
    (service() as any).lockPayment.mockResolvedValueOnce({ ...payment, clientId: 'other-client' });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('do not own this payment');
  });

  it('requires a completed task', async () => {
    mocks.taskWhere.mockReturnValue({ first: vi.fn().mockResolvedValue({ ...task, status: 'IN_PROGRESS' }) });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('both be COMPLETED');
  });

  it('requires a completed contract', async () => {
    mocks.contractWhere.mockReturnValue({ first: vi.fn().mockResolvedValue({ ...contract, status: 'ACTIVE' }) });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('both be COMPLETED');
  });

  it('requires FUNDED payment', async () => {
    (service() as any).lockPayment.mockResolvedValueOnce({ ...payment, status: 'PENDING' });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('Payment must be FUNDED');
  });

  it('requires payment/contract/task relationships to match', async () => {
    (service() as any).lockPayment.mockResolvedValueOnce({ ...payment, workerId: 'wrong-worker' });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('financial relationships');
  });

  it('requires a verified destination belonging to the contract worker', async () => {
    mocks.destinationWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(null) });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('Verified payout destination');
  });

  it('requires provider-compatible destination', async () => {
    mocks.destinationWhere.mockReturnValue({ first: vi.fn().mockResolvedValue({ ...destination, provider: 'OTHER' }) });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('compatible');
  });

  it('does not accept client-supplied payout amount', async () => {
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.payoutCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: '90', currency: 'KES' }));
    expect(mocks.payoutCreate).not.toHaveBeenCalledWith(expect.objectContaining({ amount: '100.00' }));
  });

  it('derives net payout from the existing commission', async () => {
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.ledgerWhere).toHaveBeenCalledWith({ paymentId: 'payment-1', type: 'COMMISSION' });
    expect(mocks.payoutCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: '90' }));
  });

  it('does not duplicate commission', async () => {
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.ledgerCreate).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'COMMISSION' }));
  });

  it('emits a notification only after verified payout success releases the payment', async () => {
    mocks.payoutWhere.mockReturnValue({
      first: vi.fn().mockResolvedValue({ ...payout, status: 'SUCCEEDED', providerRef: 'payout-ref' }),
      update: vi.fn().mockResolvedValue(1),
    });

    const result = await service().releasePayment(client, 'payment-1', 'dest-1');
    expect((result as any).status).toBe('RELEASED');
    expect(mocks.notificationPaymentReleased).toHaveBeenCalledWith('payment-1');
  });

  it('does not emit a release notification when payout initiation does not establish success', async () => {
    mocks.provider.initiatePayout.mockResolvedValueOnce({ status: 'PROCESSING', provider: 'TEST', providerRef: 'payout-ref' });
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.notificationPaymentReleased).not.toHaveBeenCalled();
  });

  it('reuses the stable payout identity', async () => {
    const existing = { ...payout, id: 'existing', status: 'PENDING' };
    mocks.payoutWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(existing), update: vi.fn().mockResolvedValue(1) });
    const result = await service().releasePayment(client, 'payment-1', 'dest-1');
    expect((result as any).payout).toMatchObject({ id: 'existing', status: 'PENDING' });
    expect(mocks.payoutCreate).not.toHaveBeenCalled();
  });

  it('initiates provider payout only after the local intent transaction', async () => {
    let committed = false;
    mocks.transaction.mockImplementation(async (callback) => {
      const result = await callback(tx());
      committed = true;
      return result;
    });
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(committed).toBe(true);
    expect(mocks.provider.initiatePayout).toHaveBeenCalled();
  });

  it('keeps provider reference separate from funding reference', async () => {
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.provider.initiatePayout).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 'payout-1' }));
    const updateCalls = mocks.payoutWhere.mock.results.map(() => true);
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(payment.providerRef).toBe('fund-ref');
    expect(payout.providerRef).toBeNull();
  });

  it('handles unavailable provider without marking success', async () => {
    mocks.provider.initiatePayout.mockRejectedValueOnce(new ServiceUnavailableException('not configured'));
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('not configured');
  });

  it('turns provider timeout into UNKNOWN', async () => {
    mocks.provider.initiatePayout.mockRejectedValueOnce(new (await import('@nestjs/common')).GatewayTimeoutException('timeout'));
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('uncertain');
    expect(mocks.auditCreate).toHaveBeenCalled();
  });

  it('never blindly initiates an UNKNOWN payout', async () => {
    const unknown = { ...payout, status: 'UNKNOWN', providerRef: 'payout-ref' };
    mocks.payoutWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(unknown), update: vi.fn().mockResolvedValue(1) });
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.provider.initiatePayout).not.toHaveBeenCalled();
    expect(mocks.provider.reconcilePayout).toHaveBeenCalled();
  });

  it('reconciles PROCESSING rather than initiating another payout', async () => {
    const processing = { ...payout, status: 'PROCESSING', providerRef: 'payout-ref' };
    mocks.payoutWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(processing), update: vi.fn().mockResolvedValue(1) });
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.provider.initiatePayout).not.toHaveBeenCalled();
    expect(mocks.provider.reconcilePayout).toHaveBeenCalled();
  });

  it('rejects unsafe reconciliation without a provider reference', async () => {
    const unknown = { ...payout, status: 'UNKNOWN', providerRef: null };
    mocks.payoutWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(unknown), update: vi.fn().mockResolvedValue(1) });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('no provider reference');
  });

  it('verified reconciliation completes the payout', async () => {
    const processing = { ...payout, status: 'PROCESSING', providerRef: 'payout-ref' };
    mocks.payoutWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(processing), update: vi.fn().mockResolvedValue(1) });
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.provider.reconcilePayout).toHaveBeenCalledWith(expect.objectContaining({ payoutId: 'payout-1', amount: '90.00', currency: 'KES' }));
  });

  it('rejects payout amount mismatch during verified completion', async () => {
    const bad = { ...payout, amount: '95.00', status: 'PROCESSING', providerRef: 'payout-ref' };
    mocks.payoutWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(bad), update: vi.fn().mockResolvedValue(1) });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('net payout');
  });

  it('verified success creates exactly one RELEASE ledger entry', async () => {
    const instance = service();
    await (instance as any).completeVerifiedSuccess('payout-1', 'TEST_SUCCESS');
    expect(mocks.ledgerCreate).toHaveBeenCalledWith(expect.objectContaining({ type: 'RELEASE', amount: '90.00', currency: 'KES', reference: 'payout-1' }));
    expect(mocks.ledgerCreate).toHaveBeenCalledTimes(1);
  });

  it('verified success transitions payment to RELEASED', async () => {
    const instance = service();
    await (instance as any).completeVerifiedSuccess('payout-1', 'TEST_SUCCESS');
    expect(mocks.paymentWhere).toHaveBeenCalled();
  });

  it('verified success transitions payout to SUCCEEDED', async () => {
    const instance = service();
    await (instance as any).completeVerifiedSuccess('payout-1', 'TEST_SUCCESS');
    expect(mocks.payoutWhere).toHaveBeenCalled();
  });

  it('does not release when provider failure is verified', async () => {
    const failed = { ...payout, status: 'FAILED' };
    mocks.payoutWhere.mockReturnValue({ first: vi.fn().mockResolvedValue(failed), update: vi.fn().mockResolvedValue(1) });
    await expect((service() as any).completeVerifiedSuccess('payout-1', 'TEST_FAILURE')).rejects.toThrow('cannot be marked successful');
  });

  it('already RELEASED completion is idempotent', async () => {
    (service() as any).lockPayment.mockResolvedValueOnce({ ...payment, status: 'RELEASED' });
    const result = await (service() as any).completeVerifiedSuccess('payout-1', 'IDEMPOTENT');
    expect(result.status).toBe('RELEASED');
  });

  it('does not create a duplicate RELEASE entry when one exists', async () => {
    mocks.ledgerWhere.mockImplementation((where: { type: string }) => ({
      first: vi.fn().mockResolvedValue(
        where.type === 'RELEASE'
          ? { id: 'release-existing', type: 'RELEASE', paymentId: 'payment-1' }
          : commission,
      ),
    }));
    await (service() as any).completeVerifiedSuccess('payout-1', 'IDEMPOTENT');
    expect(mocks.ledgerCreate).not.toHaveBeenCalled();
  });

  it('provider destination credentials are passed to the adapter but never audited', async () => {
    await service().releasePayment(client, 'payment-1', 'dest-1');
    const auditStrings = mocks.auditCreate.mock.calls.map((call: any[]) => JSON.stringify(call[0]));
    expect(auditStrings.join(' ')).not.toContain('acct-secret');
  });

  it('request cannot select another worker', async () => {
    mocks.destinationWhere.mockReturnValue({ first: vi.fn().mockResolvedValue({ ...destination, userId: 'other-worker' }) });
    await expect(service().releasePayment(client, 'payment-1', 'dest-1')).rejects.toThrow('Verified payout destination');
  });

  it('request cannot supply a worker override', async () => {
    await service().releasePayment(client, 'payment-1', 'dest-1');
    expect(mocks.provider.initiatePayout.mock.calls[0][0].destination.providerAccountRef).toBe('acct-secret');
    expect(mocks.provider.initiatePayout.mock.calls[0][0]).not.toHaveProperty('workerId');
  });

  it('completed task and contract are rechecked at success', async () => {
    mocks.taskWhere.mockReturnValue({ first: vi.fn().mockResolvedValue({ ...task, status: 'IN_PROGRESS' }) });
    await expect((service() as any).completeVerifiedSuccess('payout-1', 'TEST_SUCCESS')).rejects.toThrow('Completed task and contract');
  });
});
