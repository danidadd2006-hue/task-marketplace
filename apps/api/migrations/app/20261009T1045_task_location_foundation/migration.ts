#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/644253e42c2cf55c552dea0302b896dabf316f79467fd7ed21a32c3b61ee62e5/contract';
import endContract from '../../snapshots/644253e42c2cf55c552dea0302b896dabf316f79467fd7ed21a32c3b61ee62e5/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/73717cc6361a988b93a352af5ee6b85bb47b9936258f25092f1fa97d8543c473/contract';
import startContract from '../../snapshots/73717cc6361a988b93a352af5ee6b85bb47b9936258f25092f1fa97d8543c473/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'taskLocation',
        columns: [
          col('area', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('cityId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('countryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('regionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('taskId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-string@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'taskLocation',
        constraint: 'taskLocation_taskId_key',
        columns: ['taskId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'taskLocation',
        index: 'taskLocation_cityId_idx_1ab1b247',
        columns: ['cityId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'taskLocation',
        index: 'taskLocation_countryId_idx_27b43b27',
        columns: ['countryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'taskLocation',
        index: 'taskLocation_regionId_idx_f44e49e6',
        columns: ['regionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'taskLocation',
        foreignKey: {
          name: 'taskLocation_taskId_fkey',
          columns: ['taskId'],
          references: { schema: 'public', table: 'task', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'taskLocation',
        foreignKey: {
          name: 'taskLocation_countryId_fkey',
          columns: ['countryId'],
          references: { schema: 'public', table: 'country', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'taskLocation',
        foreignKey: {
          name: 'taskLocation_regionId_fkey',
          columns: ['regionId'],
          references: { schema: 'public', table: 'region', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'taskLocation',
        foreignKey: {
          name: 'taskLocation_cityId_fkey',
          columns: ['cityId'],
          references: { schema: 'public', table: 'city', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
