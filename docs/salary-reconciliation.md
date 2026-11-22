# Salary Reconciliation Rule (Forecast Prerequisite)

Status: Adopted 2026-11-22 (Phase 3 prerequisite from docs/sql-migration-plan.md §9 and docs/database-schema.md §10)

## Problem

The forecast includes the expected salary on the next payday. If the user records their actual salary as an income transaction dated on or before that payday, the forecast must not count the money twice (once as "expected", once as "recorded"). The data model has no explicit "this transaction IS the salary" flag, so a matching rule is required. The rule must not match unrelated income merely because amounts are equal.

## Constraints

- No schema change is desired for this phase; any solution must work with the existing `transactions`, `income_schedules`, and `categories` tables.
- Every user has a system income category named **"Salary"** (`is_system = true`) seeded at signup, and the app's category picker exposes it. This is the most reliable salary marker available without new columns.
- Transaction descriptions are free text and untrusted; they may not be used as the primary matching key.

## Adopted rule

An income transaction T reconciles against the expected payday P (schedule S with expected amount A) when ALL of the following hold:

1. **Category:** `T.category_id` is the user's system "Salary" category (income, `is_system = true`).
2. **Date:** `T.transaction_date` is within the inclusive window `[P − 3 days, P]`. Salary postings sometimes land a few days early; never after the payday itself for this window, because a post-payday income row is simply activity after the forecast start and is counted normally.
3. **Amount:** `|amount(T) − A| ≤ 0.01` (cent-level tolerance for numeric round-tripping).

If a matching transaction exists, the forecast **drops the expected salary line** for that payday and counts the actual transaction instead (it is recorded income in the normal transaction flow). This is a conservative one-to-one match: the earliest qualifying transaction by date (then created_at) reconciles the single expected occurrence; all other income transactions count as ordinary recorded income.

## Why this is reliable enough

- Requirement 1 restricts matches to transactions the user has explicitly categorized as salary — a random freelance payment, refund, or gift would have to be categorized "Salary" AND be within 3 days of the payday AND match the expected amount to the centavo. That conjunction is not "merely equal amounts."
- If the user pays themselves through a differently-named category, the reconciliation will not fire; the forecast then shows both the actual income and the expected salary, which would overstate income. This is a known limitation (below).

## Known limitations (explicit)

- **No hard link:** the model cannot prove a transaction is the salary. The heuristic can false-negative (user categorizes salary under "Other Income" → expected salary is still added, overstating income) or, far more rarely, false-positive (an unrelated income categorized "Salary" with the exact expected amount within 3 days of payday).
- **One occurrence per payday window:** only the next payday's occurrence is reconciled; the forecast horizon is a single payday, so this suffices.
- **Amount edits:** if the user's actual salary differs from the schedule's expected amount by more than one centavo, reconciliation does not fire. The forecast then includes both the actual transaction and the expected salary. The Forecast page discloses this assumption and links to Settings to update the schedule.

## Minimal schema improvement (proposed, NOT implemented)

If false results become a real problem, add a nullable `linked_income_schedule_id uuid` column on `transactions` (FK to income_schedules, RESTRICT) plus a small "Received salary" action that stamps it. Reconciliation then becomes an exact key match. This requires a migration and UI change and is intentionally deferred until justified by observed misuse.

## Test contract (must be verified when tests run)

- Transaction in Salary category, same date as payday, exact amount → expected salary dropped, no double count.
- Same but dated payday − 3 → dropped.
- Same but dated payday − 4 → NOT dropped (both counted; disclosed).
- Same but amount differs by 0.02 → NOT dropped.
- Same but category = "Other Income" → NOT dropped.
- Two qualifying transactions → only one reconciles the expected occurrence.
