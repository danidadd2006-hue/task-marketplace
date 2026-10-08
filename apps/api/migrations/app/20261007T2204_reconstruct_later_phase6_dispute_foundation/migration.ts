#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/de4c3fe3e2ace8a30b908f7a9c583c50baac2ccbefe74c964531425bf581cd95/contract';
import startContract from '../../snapshots/de4c3fe3e2ace8a30b908f7a9c583c50baac2ccbefe74c964531425bf581cd95/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a142e3e46839c6118b0e524b9eaf6b91c408dec37f0f711e15ba848a8791e1a6/contract';
import endContract from '../../snapshots/a142e3e46839c6118b0e524b9eaf6b91c408dec37f0f711e15ba848a8791e1a6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('activeKey', 'text'),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('category', 'text', { notNull: true, default: { kind: 'literal', value: 'OTHER' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('contractId', 'text', { notNull: true }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('relatedFinancialActionRef', 'text'),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('resolutionActorId', 'text'),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('resolutionAt', 'timestamptz'),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('resolutionCode', 'text'),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('resolutionReason', 'text'),
      }),
      this.addColumn({
        schema: 'public',
        table: 'dispute',
        column: col('trustCaseId', 'text', { notNull: true }),
      }),

      this.addUnique({
        schema: 'public',
        table: 'dispute',
        constraint: 'dispute_trustCaseId_key',
        columns: ['trustCaseId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'dispute',
        constraint: 'dispute_activeKey_key',
        columns: ['activeKey'],
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

      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_taskId_fkey',
          columns: ['taskId'],
          references: {
            schema: 'public',
            table: 'task',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_contractId_fkey',
          columns: ['contractId'],
          references: {
            schema: 'public',
            table: 'contract',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_paymentId_fkey',
          columns: ['paymentId'],
          references: {
            schema: 'public',
            table: 'payment',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_raisedById_fkey',
          columns: ['raisedById'],
          references: {
            schema: 'public',
            table: 'user',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_resolutionActorId_fkey',
          columns: ['resolutionActorId'],
          references: {
            schema: 'public',
            table: 'user',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'dispute',
        foreignKey: {
          name: 'dispute_trustCaseId_fkey',
          columns: ['trustCaseId'],
          references: {
            schema: 'public',
            table: 'trustCase',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),

      this.addColumn({
        schema: 'public',
        table: 'disputeEvidence',
        column: col('referenceId', 'text'),
      }),
      this.addColumn({
        schema: 'public',
        table: 'disputeEvidence',
        column: col('referenceType', 'text'),
      }),

      this.addForeignKey({
        schema: 'public',
        table: 'disputeEvidence',
        foreignKey: {
          name: 'disputeEvidence_disputeId_fkey',
          columns: ['disputeId'],
          references: {
            schema: 'public',
            table: 'dispute',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
