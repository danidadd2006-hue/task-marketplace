# Reconstructed Later Phase 6 Migration — Provenance Note

The original migration from the Step 6.5 contract to the a142e3 contract was unavailable in repository/local provenance and was reconstructed from the authoritative de4c3fe3 and a142e3 contract snapshots.

This reconstructed migration is not claimed to be the original historical migration.

Authoritative parent contract:
de4c3fe3e2ace8a30b908f7a9c583c50baac2ccbefe74c964531425bf581cd95

Authoritative target/live contract:
a142e3e46839c6118b0e524b9eaf6b91c408dec37f0f711e15ba848a8791e1a6

The reconstruction is limited to the independently verified storage delta between those two contracts: additions to public.dispute and public.disputeEvidence only.

No new models are introduced by this transition, and no enum-member changes are introduced. Any domain enum/value-set representations remain those already present in the authoritative contracts.

The live database is already at the target a142e3 contract. This reconstructed migration has NOT been applied to the live database.

The reconstructed migration adds three NOT NULL dispute columns without inventing backfill data: contractId, trustCaseId, and category. The category column retains the authoritative target default OTHER. Applying this migration to a populated pre-target dispute table would require an approved data-preserving backfill/reconciliation strategy for required identifiers before the NOT NULL/FK constraints can safely hold.

Unique constraints on dispute.trustCaseId and dispute.activeKey, and the new foreign keys, may also encounter conflicts if pre-target data exists. No data-resolution assumptions are encoded in this reconstruction.

The repository migration graph is reconstructed as:
29495399...
  -> reconstructed Step 6.5 -> de4c3fe3...
  -> reconstructed later Phase 6 dispute transition -> a142e3...

No database marker or migration ref was manually edited to make the target a graph node; the a142e3 node is supplied by this migration's authoritative end contract.
