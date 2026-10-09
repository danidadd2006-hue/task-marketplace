#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/35d3a4e2a263bbb49d80e61af2d656c76d76dcd76c2469259bde4d86db4e031c/contract';
import startContract from '../../snapshots/35d3a4e2a263bbb49d80e61af2d656c76d76dcd76c2469259bde4d86db4e031c/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/73717cc6361a988b93a352af5ee6b85bb47b9936258f25092f1fa97d8543c473/contract';
import endContract from '../../snapshots/73717cc6361a988b93a352af5ee6b85bb47b9936258f25092f1fa97d8543c473/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'cancellation',
        constraint: 'cancellation_calculationBasis_check_7be19a77',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'cancellation',
        constraint: 'cancellation_category_check_ba2a6cb9',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'workerCancellationPenalty',
        constraint: 'worker_cancellation_penalty_sequence_check_937b68e9',
      }),
      this.createTable({
        schema: 'public',
        table: 'tokenPurchase',
        columns: [
          col('amount', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('currency', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('paidAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
          col('provider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('providerRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('tokenAmount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('tokenPackageId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'tokenPurchase_status_check_2a508822',
            "\"status\" IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'tokenPurchaseProviderEvent',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('processedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('providerEventId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('providerRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('tokenPurchaseId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'tokenPurchaseProviderEvent_type_check_25461a12',
            "\"type\" IN ('PURCHASE_SUCCEEDED', 'PURCHASE_FAILED', 'PURCHASE_CANCELLED')",
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('activeKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('category', 'text', {
          notNull: true,
          default: lit('OTHER'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('relatedFinancialActionRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('resolutionActorId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('resolutionAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-string@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('resolutionCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('resolutionReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'disputeEvidence',
        column: col('referenceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'disputeEvidence',
        column: col('referenceType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('activeKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('contractId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('trustCaseId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('category', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('targetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('targetType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('trustCaseId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'cancellation',
        constraint: 'cancellation_calculationBasis_check_63b63c02',
        expression:
          "\"calculationBasis\" IN ('NO_FINANCIAL_ALLOCATION', 'FIRST_DAY_FULL_REFUND', 'LONG_JOB_ELAPSED_ALLOCATION', 'EXTENSION_90_PERCENT_REFUND', 'EXPIRY_FULL_REFUND', 'ADMINISTRATIVE')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'cancellation',
        constraint: 'cancellation_category_check_f844bb84',
        expression:
          "\"category\" IN ('PRE_WORK_FIRST_DAY', 'LONG_JOB_ELAPSED', 'EXTENSION', 'EXPIRY_REFUND', 'ADMINISTRATIVE')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'dispute',
        constraint: 'dispute_activeKey_key',
        columns: ['activeKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'dispute',
        constraint: 'dispute_trustCaseId_key',
        columns: ['trustCaseId'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'report',
        constraint: 'report_category_check_024ea8fd',
        expression:
          "\"category\" IN ('CONTENT', 'CONDUCT', 'SAFETY', 'TRANSACTION', 'PRIVACY', 'AUTHENTICITY', 'OTHER')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'report',
        constraint: 'report_targetType_check_829377f7',
        expression: "\"targetType\" IN ('USER', 'TASK', 'MESSAGE', 'REVIEW')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'report',
        constraint: 'report_activeKey_key',
        columns: ['activeKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'report',
        constraint: 'report_trustCaseId_key',
        columns: ['trustCaseId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'tokenPurchase',
        constraint: 'tokenPurchase_provider_providerRef_key',
        columns: ['provider', 'providerRef'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'tokenPurchaseProviderEvent',
        constraint: 'tokenPurchaseProviderEvent_provider_providerEventId_key',
        columns: ['provider', 'providerEventId'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'workerCancellationPenalty',
        constraint: 'worker_cancellation_penalty_sequence_check_788d9c27',
        expression: '"sequenceNumber" >= 1 AND "sequenceNumber" <= 4',
      }),
      this.createIndex({
        schema: 'public',
        table: 'dispute',
        index: 'dispute_contractId_idx_102708cf',
        columns: ['contractId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dispute',
        index: 'dispute_resolutionActorId_idx_14eda2aa',
        columns: ['resolutionActorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'dispute',
        index: 'dispute_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'report',
        index: 'report_reporterId_createdAt_idx_468b5f4f',
        columns: ['reporterId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'report',
        index: 'report_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'report',
        index: 'report_targetType_targetId_status_idx_f4be9279',
        columns: ['targetType', 'targetId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tokenPurchase',
        index: 'tokenPurchase_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tokenPurchase',
        index: 'tokenPurchase_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tokenPurchase',
        index: 'tokenPurchase_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tokenPurchaseProviderEvent',
        index: 'tokenPurchaseProviderEvent_processedAt_idx_e83f4a54',
        columns: ['processedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tokenPurchaseProviderEvent',
        index: 'tokenPurchaseProviderEvent_tokenPurchaseId_idx_b68a9c53',
        columns: ['tokenPurchaseId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'tokenPurchaseProviderEvent',
        index: 'tokenPurchaseProviderEvent_type_idx_b6b604ea',
        columns: ['type'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_contractId_fkey',
          columns: ['contractId'],
          references: { schema: 'public', table: 'contract', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_paymentId_fkey',
          columns: ['paymentId'],
          references: { schema: 'public', table: 'payment', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_raisedById_fkey',
          columns: ['raisedById'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_resolutionActorId_fkey',
          columns: ['resolutionActorId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_taskId_fkey',
          columns: ['taskId'],
          references: { schema: 'public', table: 'task', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_trustCaseId_fkey',
          columns: ['trustCaseId'],
          references: { schema: 'public', table: 'trustCase', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'disputeEvidence',
        foreignKey: {
          name: 'disputeEvidence_disputeId_fkey',
          columns: ['disputeId'],
          references: { schema: 'public', table: 'dispute', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'report',
        foreignKey: {
          name: 'report_reporterId_fkey',
          columns: ['reporterId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'report',
        foreignKey: {
          name: 'report_trustCaseId_fkey',
          columns: ['trustCaseId'],
          references: { schema: 'public', table: 'trustCase', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'tokenPurchase',
        foreignKey: {
          name: 'tokenPurchase_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'tokenPurchaseProviderEvent',
        foreignKey: {
          name: 'tokenPurchaseProviderEvent_tokenPurchaseId_fkey',
          columns: ['tokenPurchaseId'],
          references: { schema: 'public', table: 'tokenPurchase', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
