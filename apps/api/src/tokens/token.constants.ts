export const DEFAULT_STARTING_WORKER_TOKENS = 100;
export const DEFAULT_APPLICATION_TOKEN_COST = 5;

export const DEFAULT_TOKEN_PACKAGE = {
  id: 'starter-50',
  name: '50 Tokens',
  tokenAmount: 50,
  price: '5.00',
  currency: 'USD',
} as const;

export function getApplicationTokenCost(): number {
  const configured = Number.parseInt(process.env['TOKEN_APPLICATION_COST'] ?? '', 10);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_APPLICATION_TOKEN_COST;
}

export function getStartingWorkerTokenGrant(): number {
  const configured = Number.parseInt(process.env['WORKER_STARTING_TOKENS'] ?? '', 10);
  return Number.isInteger(configured) && configured >= 0 ? configured : DEFAULT_STARTING_WORKER_TOKENS;
}
