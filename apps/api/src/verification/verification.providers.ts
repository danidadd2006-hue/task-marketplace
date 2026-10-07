import { randomBytes } from 'node:crypto';
import type { VerificationType } from './verification.types.js';

export interface VerificationProvider {
  readonly name: string;
  createVerification(input: { userId: string; type: VerificationType }): Promise<{ providerRef?: string }>;
}

export interface VerificationChallengeProvider {
  readonly name: string;
  issueChallenge(input: { userId: string; type: 'EMAIL' | 'PHONE' }): Promise<string>;
  deliverChallenge(input: { userId: string; type: 'EMAIL' | 'PHONE'; challenge: string }): Promise<void>;
}

export class LocalVerificationProvider implements VerificationProvider {
  readonly name = 'local';

  async createVerification(input: { userId: string; type: VerificationType }) {
    return { providerRef: `local:${input.type.toLowerCase()}:${input.userId}` };
  }
}

export class LocalVerificationChallengeProvider implements VerificationChallengeProvider {
  readonly name = 'local';

  async issueChallenge(_input: { userId: string; type: 'EMAIL' | 'PHONE' }): Promise<string> {
    return randomBytes(32).toString('hex');
  }

  async deliverChallenge(_input: { userId: string; type: 'EMAIL' | 'PHONE'; challenge: string }): Promise<void> {
    return;
  }
}
