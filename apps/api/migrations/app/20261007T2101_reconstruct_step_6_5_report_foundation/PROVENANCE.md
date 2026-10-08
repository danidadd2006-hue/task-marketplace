# Reconstructed Step 6.5 Migration — Provenance Note

The original Step 6.4 -> Step 6.5 migration package was unavailable in repository/local provenance and was reconstructed from the authoritative Step 6.4 parent contract and Step 6.5 target contract.

This reconstructed migration is NOT claimed to be the original historical migration.

Authoritative parent contract:
29495399a54712054fdf2883680caf2c7832743ab066c135b411b6793e8f367a

Authoritative Step 6.5 target contract:
de4c3fe3e2ace8a30b908f7a9c583c50baac2ccbefe74c964531425bf581cd95

The reconstruction is intentionally limited to the verified Step 6.5 Report schema delta.

The two Step 6.5 enums are text-backed value sets (pg/text@1) in the authoritative target contract. They therefore materialize through the target Report CHECK constraints rather than PostgreSQL CREATE TYPE statements.

The live database is currently at a later contract:
a142e3e46839c6118b0e524b9eaf6b91c408dec37f0f711e15ba848a8791e1a6

This migration has NOT been applied to the live database.

Because four required Report columns are added as NOT NULL columns without defaults, applying this reconstruction to a populated Step 6.4 Report table would require an explicit, approved data-preserving backfill strategy. No backfill values are invented in this reconstruction.
