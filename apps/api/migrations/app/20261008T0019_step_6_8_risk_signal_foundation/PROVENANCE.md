# Phase 6 — Step 6.8 — Risk Signal Foundation Provenance

This migration is an authored repository transition for Phase 6 — Step 6.8. It is not a recovery of any missing historical migration.

## Contract transition

- Start contract: a142e3e46839c6118b0e524b9eaf6b91c408dec37f0f711e15ba848a8791e1a6
- End contract: 35d3a4e2a263bbb49d80e61af2d656c76d76dcd76c2469259bde4d86db4e031c
- Migration hash: ef956f6a365870b8fad9bf8cbb25ac18a16e1b188ec5cde9d8286cbcd3e21754
- Operations: 12 total — 12 additive, 0 destructive

## Scope

The transition adds the durable public.riskSignal entity and its supporting primary key, unique deduplication constraint, severity/subject/source validation checks, Prisma-generated indexes, and optional foreign key to the existing public.trustCase investigation architecture.

No existing tables are modified by this transition. No native enum types are introduced. The existing TrustCase RISK type and shared TrustCase history/evidence/decision architecture remain authoritative for investigations.

## Data/backfill assessment

Before the schema change was authored, the live database was inspected at contract a142e3. The affected TrustCase, TrustCaseHistory, TrustCaseEvidence, TrustCaseDecision, and all existing authoritative source-domain tables inspected for risk signals contained zero rows in the live environment at that time. The new riskSignal table therefore has no backfill requirement.

No historical or synthetic signal observations are invented by this migration.

## Safety

The migration contains 12 additive operations and 0 destructive operations.

It was applied to the authoritative live database through the proper Prisma migration runner. The live database is now at contract 35d3a4e2a263bbb49d80e61af2d656c76d76dcd76c2469259bde4d86db4e031c.

No destructive database operation, reset, drop, recreate, truncate, or destructive migration was performed.

## Application boundary

Risk detection is an investigation/signal foundation only. Risk signals do not directly authorise irreversible account, payment, payout, refund, ledger, application, or transaction state changes.

Any eventual enforcement is delegated through the existing Step 6.7 AccountService or ModerationService boundaries.

## Reconstruction/provenance boundary

The previously accepted migration provenance boundary at 29495399... is preserved. Existing reconstructed Phase 6 migrations were not rewritten or applied as part of Step 6.8.

## Repository reconciliation

The authoritative Step 6.8 migration is:

apps/api/migrations/app/20261008T0019_step_6_8_risk_signal_foundation/

A stray duplicate Step 6.8 migration with conflicting destructive operations was removed from the repository. The future TokenPurchase contract at 73717cc6361a988b93a352af5ee6b85bb47b9936258f25092f1fa97d8543c473 remains separate and was not modified by this reconciliation.
