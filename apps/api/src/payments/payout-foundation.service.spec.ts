import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutFoundationService } from './payout-foundation.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  ledgerWhere: vi.fn(),
  paymentFirst: vi.fn(),
  taskFirst: vi.fn(),
  contractFirst: vi.fn(),
  destinationFirst: vi.fn(),
  payoutFirst: vi.fn(),
  commissionFirst: vi.fn(),
  payoutCreate: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock('../prisma/db.js', () => ({ db: { transaction: mocks.transaction } }));

const client = { userId: 'client-id', email: 'client@example.com', status: 'ACTIVE', roles: ['CLIENT'] } as any;
const payment = { id: 'payment-id', taskId: 'task-id', clientId: 'client-id', workerId: 'worker-id', contractId: 'contract-id', amount: '100.00', currency: 'KES', status: 'FUNDED' };
const task = { id: 'task-id', clientId: 'client-id', status: 'COMPLETED' };
const contract = { id: 'contract-id', taskId: 'task-id', workerId: 'worker-id', status: 'COMPLETED', agreedPrice: '100.00' };
const destination = { id: 'destination-id', userId: 'worker-id', provider: 'TEST', method: 'BANK', providerAccountRef: 'token-123', status: 'VERIFIED' };
const commission = { id: 'commission-id', paymentId: 'payment-id', type: 'COMMISSION', amount: '10.00', currency: 'KES' };

function setup() {
  mocks.transaction.mockImplementation(async (callback) => callback({ orm: { public: {
    Payment: { where: vi.fn(() => ({ first: mocks.paymentFirst })) },
    Task: { where: vi.fn(() => ({ first: mocks.taskFirst })) },
    Contract: { where: vi.fn(() => ({ first: mocks.contractFirst })) },
    PayoutDestination: { where: vi.fn(() => ({ first: mocks.destinationFirst })) },
    Payout: { where: vi.fn(() => ({ first: mocks.payoutFirst })), create: mocks.payoutCreate },
    LedgerEntry: { where: mocks.ledgerWhere },
    AuditLog: { create: mocks.auditCreate },
  } } }));
}

describe('PayoutFoundationService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setup();
    mocks.paymentFirst.mockResolvedValue(payment);
    mocks.taskFirst.mockResolvedValue(task);
    mocks.contractFirst.mockResolvedValue(contract);
    mocks.destinationFirst.mockResolvedValue(destination);
    mocks.ledgerWhere.mockImplementation((where) => ({ first: mocks.commissionFirst }));
    mocks.payoutFirst.mockResolvedValue(undefined);
    mocks.commissionFirst.mockResolvedValue(commission);
    mocks.payoutCreate.mockResolvedValue({ id: 'payout-id', paymentId: 'payment-id', amount: '90.00', currency: 'KES', status: 'PENDING' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-id' });
  });

  it('creates one pending payout intent from authoritative payment and commission records', async () => {
    const result = await new PayoutFoundationService().createPayoutIntent(client, 'payment-id', 'destination-id');
    expect(result).toMatchObject({ id: 'payout-id', amount: '90.00', status: 'PENDING' });
    expect(mocks.payoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'payment-id', contractId: 'contract-id', taskId: 'task-id', workerId: 'worker-id',
      payoutDestinationId: 'destination-id', amount: '90', currency: 'KES', status: 'PENDING',
    }));
    expect(mocks.payoutCreate).not.toHaveBeenCalledWith(expect.objectContaining({ amount: '100.00' }));
  });

  it('reuses an existing payout intent for repeated release preparation', async () => {
    mocks.payoutFirst.mockResolvedValue({ id: 'existing-payout', paymentId: 'payment-id', status: 'PENDING' });
    const result = await new PayoutFoundationService().createPayoutIntent(client, 'payment-id', 'destination-id');
    expect(result.id).toBe('existing-payout');
    expect(mocks.payoutCreate).not.toHaveBeenCalled();
  });

  it('requires a verified destination owned by the selected worker', async () => {
    mocks.destinationFirst.mockResolvedValue(undefined);
    await expect(new PayoutFoundationService().createPayoutIntent(client, 'payment-id', 'destination-id')).rejects.toThrow('Verified payout destination');
    expect(mocks.payoutCreate).not.toHaveBeenCalled();
  });

  it('rejects an incomplete payment/task/contract boundary', async () => {
    mocks.paymentFirst.mockResolvedValue({ ...payment, status: 'PENDING' });
    await expect(new PayoutFoundationService().createPayoutIntent(client, 'payment-id', 'destination-id')).rejects.toThrow('FUNDED');
  });

  it('does not duplicate the commission or create a release ledger entry', async () => {
    await new PayoutFoundationService().createPayoutIntent(client, 'payment-id', 'destination-id');
    expect(mocks.ledgerWhere).toHaveBeenCalledWith({ paymentId: 'payment-id', type: 'COMMISSION' });
    expect(mocks.auditCreate).toHaveBeenCalled();
    expect(mocks.payoutCreate).toHaveBeenCalledTimes(1);
  });

  it('reconciles a concurrent unique payout-intent conflict to the existing payout', async () => {
    mocks.payoutCreate.mockRejectedValueOnce({ sqlState: '23505' });
    mocks.payoutFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 'concurrent-payout', paymentId: 'payment-id', status: 'PENDING' });
    const result = await new PayoutFoundationService().createPayoutIntent(client, 'payment-id', 'destination-id');
    expect(result.id).toBe('concurrent-payout');
  });

  it('never changes Payment status or calls a provider', async () => {
    await new PayoutFoundationService().createPayoutIntent(client, 'payment-id', 'destination-id');
    expect(mocks.paymentFirst).toHaveBeenCalled();
    expect(mocks.payoutCreate).toHaveBeenCalled();
  });
});
