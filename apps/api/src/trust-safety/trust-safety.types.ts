import type { AuthenticatedUser } from '../auth/authenticated-user.js';

export type TrustCaseActor = AuthenticatedUser;

export interface TrustCaseCreateInput {
  type: 'REPORT' | 'DISPUTE' | 'MODERATION' | 'RISK';
  category?: string;
  subjectType: string;
  subjectId: string;
  reason?: string;
}

export interface TrustCaseEvidenceInput {
  evidenceType: 'ATTACHMENT' | 'MESSAGE' | 'TASK' | 'CONTRACT' | 'PAYMENT' | 'REVIEW' | 'VERIFICATION' | 'MEDIA' | 'OTHER';
  referenceType: string;
  referenceId: string;
  storageRef?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TrustCaseDecisionInput {
  outcome: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}
