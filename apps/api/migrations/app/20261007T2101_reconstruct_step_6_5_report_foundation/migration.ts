#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/29495399a54712054fdf2883680caf2c7832743ab066c135b411b6793e8f367a/contract';
import startContract from '../../snapshots/29495399a54712054fdf2883680caf2c7832743ab066c135b411b6793e8f367a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/de4c3fe3e2ace8a30b908f7a9c583c50baac2ccbefe74c964531425bf581cd95/contract';
import endContract from '../../snapshots/de4c3fe3e2ace8a30b908f7a9c583c50baac2ccbefe74c964531425bf581cd95/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('activeKey', 'text'),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('category', 'text', { notNull: true }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('targetId', 'text', { notNull: true }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('targetType', 'text', { notNull: true }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'report',
        column: col('trustCaseId', 'text', { notNull: true }),
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
        constraint: 'report_trustCaseId_key',
        columns: ['trustCaseId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'report',
        constraint: 'report_activeKey_key',
        columns: ['activeKey'],
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

      this.addForeignKey({
        schema: 'public',
        table: 'report',
        foreignKey: {
          name: 'report_reporterId_fkey',
          columns: ['reporterId'],
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
        table: 'report',
        foreignKey: {
          name: 'report_trustCaseId_fkey',
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
