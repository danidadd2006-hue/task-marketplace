#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a142e3e46839c6118b0e524b9eaf6b91c408dec37f0f711e15ba848a8791e1a6/contract';
import startContract from '../../snapshots/a142e3e46839c6118b0e524b9eaf6b91c408dec37f0f711e15ba848a8791e1a6/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/35d3a4e2a263bbb49d80e61af2d656c76d76dcd76c2469259bde4d86db4e031c/contract';
import endContract from '../../snapshots/35d3a4e2a263bbb49d80e61af2d656c76d76dcd76c2469259bde4d86db4e031c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'riskSignal',
        columns: [
          col('id', 'text', { notNull: true }),
          col('signalType', 'text', { notNull: true }),
          col('subjectType', 'text', { notNull: true }),
          col('subjectId', 'text', { notNull: true }),
          col('sourceDomain', 'text', { notNull: true }),
          col('sourceReference', 'text', { notNull: true }),
          col('severity', 'text', { notNull: true }),
          col('observedAt', 'timestamptz', { notNull: true }),
          col('metadataJson', 'text'),
          col('deduplicationKey', 'text'),
          col('trustCaseId', 'text'),
          col('createdAt', 'timestamptz', { notNull: true, default: { kind: 'function', expression: 'now()' } as any }),
        ],
      }),
      this.addPrimaryKey({
        schema: 'public',
        table: 'riskSignal',
        constraint: 'riskSignal_pkey',
        columns: ['id'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'riskSignal',
        constraint: 'riskSignal_deduplicationKey_key',
        columns: ['deduplicationKey'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'riskSignal',
        constraint: 'riskSignal_severity_check',
        expression: '"severity" IN (\'LOW\', \'MEDIUM\', \'HIGH\', \'CRITICAL\')',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'riskSignal',
        constraint: 'riskSignal_subjectType_check',
        expression: '"subjectType" IN (\'USER\', \'TASK\', \'APPLICATION\', \'CONTRACT\', \'PAYMENT\', \'PAYOUT\', \'TOKEN_TRANSACTION\', \'CONVERSATION\', \'MESSAGE\', \'REVIEW\', \'VERIFICATION\')',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'riskSignal',
        constraint: 'riskSignal_sourceDomain_check',
        expression: '"sourceDomain" IN (\'ACCOUNT\', \'PAYMENT\', \'MARKETPLACE\', \'TOKENS\', \'REVIEWS\', \'MESSAGING\', \'VERIFICATION\')',
      }),
      this.createIndex({
        schema: 'public',
        table: 'riskSignal',
        index: 'riskSignal_subjectType_subjectId_observedAt_idx_f119982b',
        columns: ['subjectType', 'subjectId', 'observedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'riskSignal',
        index: 'riskSignal_signalType_severity_observedAt_idx_dbf21d7d',
        columns: ['signalType', 'severity', 'observedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'riskSignal',
        index: 'riskSignal_sourceDomain_sourceReference_idx_d73e55a2',
        columns: ['sourceDomain', 'sourceReference'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'riskSignal',
        index: 'riskSignal_trustCaseId_createdAt_idx_b9a7034f',
        columns: ['trustCaseId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'riskSignal',
        index: 'riskSignal_trustCaseId_idx_b2894b73',
        columns: ['trustCaseId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'riskSignal',
        foreignKey: {
          name: 'riskSignal_trustCaseId_fkey',
          columns: ['trustCaseId'],
          references: {
            schema: 'public',
            table: 'trustCase',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
