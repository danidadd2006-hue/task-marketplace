# Post-Phase-6 Contract Reconciliation — Provenance

This migration closes the previously missing repository migration edge from the Phase 6 Step 6.8 contract to the post-reconciliation contract captured by commit f4f9fdd.

## Contract transition

- Start contract: 35d3a4e2a263bbb49d80e61af2d656c76d76dcd76c2469259bde4d86db4e031c
- End contract snapshot: 73717cc6361a988b93a352af5ee6b85bb47b9936258f25092f1fa97d8543c473
- Origin evidence: commit f4f9fdd (Reconcile Phase 6 and Phase 7 implementation)
- Migration package: 20261009T1018_reconcile_post_phase6_contract

## Scope

The transition reconciles only the post-35d3 schema changes already present in the authoritative source contract and historical 73717 snapshot:

- TokenPurchase and TokenPurchaseProviderEvent storage foundation and supporting constraints/indexes/relations.
- Post-35d3 cancellation constraint changes, including EXTENSION_90_PERCENT_REFUND and the worker cancellation sequence limit of 4.
- Post-35d3 dispute/report structural additions, relations, indexes, uniqueness constraints, and validation checks.
- Existing RiskSignal / Step 6.8 work is not recreated; the 35d3 contract remains the migration origin.

## Data safety boundary

No data backfill values are invented.

The target adds required NOT NULL columns to existing Dispute and Report tables without defaults. The migration therefore adds those columns as NOT NULL directly. If a 35d3 database contains rows in the affected existing tables, PostgreSQL will reject the operation atomically rather than accepting guessed contractId, trustCaseId, category, targetId, or targetType values.

This is intentional fail-closed behavior. A populated legacy table requires a separately approved, data-preserving reconciliation strategy before this edge can be applied to that environment.

The cancellation check-constraint replacement likewise does not translate removed legacy values. If existing Cancellation rows contain values no longer permitted by the target contract, the replacement check constraint fails atomically and no partial migration is committed.

## TokenPurchase

TokenPurchase and TokenPurchaseProviderEvent are new tables in this transition. No historical purchase data is fabricated or backfilled.

## Live database boundary

This migration was planned and self-emitted offline. It has NOT been applied to the live database. No migration marker, migration ref, schema, or live data was modified by this reconciliation.

## Graph purpose

This package establishes the missing repository graph edge:

35d3a4e2... -> 73717cc6...

The existing refs/db.json remains at the 35d3 contract. Advancing that ref or applying this migration is intentionally outside this repair.

## Historical provenance boundary

The 73717 snapshot was added by f4f9fdd and no migration package for that snapshot existed previously. This migration is therefore an authored reconciliation package, not a claim that the original historical migration has been recovered.
