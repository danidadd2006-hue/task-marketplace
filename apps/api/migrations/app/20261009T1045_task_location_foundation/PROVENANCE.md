# TaskLocation Foundation — Migration Provenance

## Boundary

This migration starts from contract `73717cc6361a988b93a352af5ee6b85bb47b9936258f25092f1fa97d8543c473`, the reconciled post-Phase-6 contract boundary, and targets contract `644253e42c2cf55c552dea0302b896dabf316f79467fd7ed21a32c3b61ee62e5`.

## Scope

This migration introduces only the dedicated `TaskLocation` persistence foundation:

- `taskLocation` table
- unique `taskId` constraint for the Task 1:1 relationship
- indexes on `countryId`, `regionId`, and `cityId`
- foreign keys to `Task`, `Country`, `Region`, and `City`

No legacy `Task.locationDescription` data is transformed or backfilled.

## Safety boundary

This package does not apply itself to the live database. The database migration marker remains at the pre-application state until an explicitly authorized deployment applies the migration.

The migration contains no destructive operations and no data transforms.

## Location semantics

`TaskLocation` is a task-owned geographic structure. `UserLocation` remains user-owned and `MessageLocation` remains controlled messaging-location data. Exact location exposure is intentionally not implemented by this foundation migration.

## Transition

The legacy `Task.locationDescription` field remains in the contract. Existing tasks are not automatically converted from free text into structured geography. Any future legacy mapping must use an explicitly approved, auditable mapping process.
