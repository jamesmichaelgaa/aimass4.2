# Migration SQL archive — aimass4.2

This directory preserves the exact SQL applied to the Supabase database on
2026-11-22. The Supabase CLI is unsupported in this environment, so migrations
were applied through the Supabase migration tool and captured here verbatim.
These files are the GitHub record required by ADR-004; the database's migration
history is the executable source of truth.

## Applied migration files (in application order)

| # | File | What it does |
|---|------|--------------|
| 1 | `20261122102842_20261122000001_extensions_and_helpers.sql.sql` | Adds the shared `set_updated_at()` trigger function that maintains `updated_at` audit timestamps. |
| 2 | `20261122102850_20261122000002_profiles_and_categories.sql.sql` | First version of migration 2. Superseded by the re-apply of the same migration — kept because the database migration history records it. |
| 3 | `20261122102910_20261122000002_profiles_and_categories.sql.sql` | Creates `profiles` (PHP currency, Asia/Manila timezone, currency-change blocking) and user-owned `categories` with case-insensitive name uniqueness and the `(user_id, id, kind)` unique index; adds the idempotent signup trigger seeding profile + nine default system categories. |
| 4 | `20261122102921_20261122000003_financial_core.sql.sql` | Creates `cash_positions`, `income_schedules` (one active per user), `transactions` (same-owner/same-kind category composite FK), `budgets` (month-first-day check, unique overall/category budgets), `recurring_bills`, and expense-kind validation triggers. |
| 5 | `20261122102933_20261122000004_bill_payments.sql.sql` | Creates `bill_payments` (unique occurrence `(recurring_bill_id, due_date)`, unique `transaction_id` link, `ON DELETE RESTRICT`) plus the `mark_bill_occurrence_paid` SECURITY DEFINER RPC and `advance_due_date` recurrence helper. |
| 6 | `20261122102945_20261122000005_indexes_and_rls.sql.sql` | Adds query/FK indexes and the full RLS policy set: owner-scoped four-verb policies, protected system categories, no-delete for bills with payment history, read-only `bill_payments`, no client INSERT/DELETE on `profiles`. |
| 7 | `20261122103014_20261122000006_verification.sql.sql` | Structural assertions: eight tables, RLS everywhere, expected policies, unique safeguards, triggers, RPC grants, no client write grants on `bill_payments`. |
| 8 | `20261122103040_20261122000001_extensions_and_helpers.sql.sql` | Re-apply of migration 1 that pins a fixed empty `search_path` on `set_updated_at()`. |
| 9 | `20261122103049_20261122000007_function_search_path_hardening.sql.sql` | Pins a fixed empty `search_path` on the remaining helper functions and fixes `advance_due_date` clamping for short months. |
| 10 | `20261122115303_20261122110000_adr011_conditional_currency_rule.sql.sql` | Implements ADR-011: allows preferred-currency changes only while the user has no financial records (transactions, bill payments, budgets); blocks changes once any exist. Concurrency-safe via profile-row FOR SHARE locks taken by BEFORE INSERT triggers on the three record tables; grants the `preferred_currency` UPDATE column. Behavior-tested (see below). |

## Notes

- Entries 2 and 3 are the first and corrected versions of the same logical
  migration ("profiles and categories"); the first version lacked the
  `(user_id, id, kind)` unique index required by the transactions composite
  foreign key and failed during its first apply attempt.
- Entries 1 and 8 are two versions of the same logical migration; the second
  pins the function's `search_path` per the security advisor's recommendation.
- Seven logical schema changes were applied across the first nine recorded
  migration files; two were re-applies of an earlier file to fix a defect
  after first apply. File 10 is the ADR-011 currency rule.
- Every file above is exactly what the database executed; no editorial
  cleanup was performed.

## ADR-011 verification record (file 10, applied 2026-11-22)

- Structure: the three profile-row lock triggers exist on transactions,
  budgets, and bill_payments; the `preferred_currency` UPDATE grant is in
  place; the trigger function is invoker-rights with a fixed empty
  `search_path` and no table-level locks.
- Behavior, tested live against the database with temporary test users
  (removed afterward; all financial-record counts returned to zero):
  1. Allowed — a user with no financial records changed currency (PHP → USD).
  2. Blocked — after one expense transaction, the change was rejected with the
     ADR-011 error.
  3. Pass-through — with records present, display name and timezone still
     updated and the currency was untouched.
  4. Restored — deleting the transaction re-enabled the change.
  5. Blocked via budget — a budget alone also rejected the change.
  6. Restored — deleting the budget re-enabled the change back to PHP.
- Bill-payment blocking was verified structurally (the table is covered by
  the same trigger count) but not exercised live, since doing so requires a
  full bill setup and the payment RPC; it is part of the pending Phase 2
  runtime tests.
- The two-session concurrency race (currency change vs. simultaneous record
  insert) cannot be exercised through this tooling, which runs single-session
  statements; it is recorded in Phase 2 runtime tests as pending. The lock
  design (profile-row FOR SHARE vs FOR NO KEY UPDATE) is verified in place.
