export const RISK_SOURCE_DOMAINS = [
  'ACCOUNT',
  'PAYMENT',
  'MARKETPLACE',
  'TOKENS',
  'REVIEWS',
  'MESSAGING',
  'VERIFICATION',
] as const;

export type RiskSourceDomain = (typeof RISK_SOURCE_DOMAINS)[number];

export const RISK_SUBJECT_TYPES = [
  'USER',
  'TASK',
  'APPLICATION',
  'CONTRACT',
  'PAYMENT',
  'PAYOUT',
  'TOKEN_TRANSACTION',
  'CONVERSATION',
  'MESSAGE',
  'REVIEW',
  'VERIFICATION',
] as const;

export type RiskSubjectType = (typeof RISK_SUBJECT_TYPES)[number];

export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const RISK_SIGNAL_CATALOG: Record<string, {
  sourceDomain: RiskSourceDomain;
  severity: RiskSeverity;
}> = {
  ACCOUNT_UNUSUAL_CREATION: { sourceDomain: 'ACCOUNT', severity: 'MEDIUM' },
  ACCOUNT_SUSPICIOUS_STATUS_BEHAVIOUR: { sourceDomain: 'ACCOUNT', severity: 'HIGH' },
  ACCOUNT_MULTIPLE_ACCOUNT_INDICATOR: { sourceDomain: 'ACCOUNT', severity: 'HIGH' },

  PAYMENT_UNUSUAL_BEHAVIOUR: { sourceDomain: 'PAYMENT', severity: 'MEDIUM' },
  PAYMENT_ANOMALY: { sourceDomain: 'PAYMENT', severity: 'HIGH' },
  PAYMENT_REPEATED_FAILURES: { sourceDomain: 'PAYMENT', severity: 'MEDIUM' },
  PAYMENT_CHARGEBACK_REFUND_ANOMALY: { sourceDomain: 'PAYMENT', severity: 'HIGH' },

  MARKETPLACE_REPEATED_CANCELLATIONS: { sourceDomain: 'MARKETPLACE', severity: 'MEDIUM' },
  MARKETPLACE_SUSPICIOUS_APPLICATIONS: { sourceDomain: 'MARKETPLACE', severity: 'MEDIUM' },
  MARKETPLACE_ABNORMAL_TASK_APPLICATION_BEHAVIOUR: { sourceDomain: 'MARKETPLACE', severity: 'HIGH' },

  TOKENS_SUSPICIOUS_ACQUISITION_USE: { sourceDomain: 'TOKENS', severity: 'MEDIUM' },
  TOKENS_UNUSUAL_TRANSACTION_PATTERN: { sourceDomain: 'TOKENS', severity: 'MEDIUM' },

  REVIEWS_ANOMALY: { sourceDomain: 'REVIEWS', severity: 'MEDIUM' },
  REVIEWS_SUSPICIOUS_RELATIONSHIP: { sourceDomain: 'REVIEWS', severity: 'HIGH' },

  MESSAGING_OFF_PLATFORM_BEHAVIOUR: { sourceDomain: 'MESSAGING', severity: 'MEDIUM' },
  MESSAGING_SUSPICIOUS_PATTERN: { sourceDomain: 'MESSAGING', severity: 'MEDIUM' },

  VERIFICATION_UNUSUAL_ACTIVITY: { sourceDomain: 'VERIFICATION', severity: 'MEDIUM' },
  VERIFICATION_SUSPICIOUS_STATUS: { sourceDomain: 'VERIFICATION', severity: 'HIGH' },
};

export const RISK_DECISION_OUTCOMES = [
  'NO_ACTION',
  'MONITOR',
  'VERIFIED',
  'RESTRICTED',
  'ESCALATED',
] as const;

export type RiskDecisionOutcome = (typeof RISK_DECISION_OUTCOMES)[number];

