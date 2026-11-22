# Financial Verification — Stage 3 Results (Budgets)

Run date: 2026-11-22. Runner: `scripts/budget-tests.mjs` (same conventions as the
Transactions harness: real `@supabase/supabase-js` clients on the project's anon key,
real password-auth sessions — every request is RLS-scoped exactly like the running app;
no service-role key used at any point).

Final tallies: **17 PASS, 0 FAIL, 0 BLOCKED** (B-01 … B-14 plus FX-1/FX-2/FX-4 fixtures).

## Accounts

Reuses the Transactions-stage accounts (teardown was deferred for exactly this):

- A: `txa.20261122-tx@aimass-test.invalid` (75fff38f-4c1c-4bc8-8988-2aff03815b8b)
- B: `txb.20261122-tx@aimass-test.invalid` (4bf3d2c1-521e-434b-a54a-ae9864bc8ef3)
- Cleanup deferred again: Bills/Forecast stages reuse these accounts.
- Post-run state: all budget + transaction rows for A and B deleted; accounts kept.

## Fixture note (FX-4)

The plan's "Groceries"/"Transport" category names do not exist; the seeded default
expense categories are Food/Rent/Transportation/Utilities/Health/Entertainment/Other.
The harness maps **Groceries→Food** and **Transport→Transportation**; all assertions are
unchanged in substance.

## Budgets batch (B-01 … B-14)

| ID | Expected | Actual | Status | Evidence / notes |
|----|----------|--------|--------|------------------|
| B-01 | Overall budget 20000.00 for current month; reads back exact | limit=20000 month=2026-11-01, cent-compare exact | PASS | PostgREST returns numeric as JSON number; cent comparison confirms exactness. Progress math asserted in B-04. |
| B-02 | Category budget (Food 3000.00) created; one per category per month | created; category matches | PASS | |
| B-03 | Duplicate overall + duplicate category budget rejected | both rejected (unique constraint `budgets_one_…`) | PASS | DB unique indexes are the enforcement backstop; the app maps these violations to friendly messages (mapBudgetError). |
| B-04 | Overall spent 1250.00 (6.25%); category spent 1000.00 (33.33%) | overall 1250.00 / 18750.00 / 6.25%; category 1000.00 / 2000.00 / 33.33% | PASS | Transport(ation) has no budget so it only lifts overall — the 1250 vs 1000 split proves it. computeProgress mirrored exactly (bigint cents). |
| B-05 | 799.99 → not approaching; 800.00 → approaching (≥80% at limit 1000.00) | 799.99 → ok (79.99%); 800.00 → warning (80%) | PASS | Both boundary states observed via one probe row updated in place. |
| B-06 | 1000.00 → exceeded; 1200.00 → exceeded with over-amount | 1000.00 → over, remaining 0.00; 1200.00 → over, remaining −200.00 | PASS | |
| B-07 | Uncategorized expense counts toward overall only | overall 77.77; category bucket 0.00 | PASS | Confirms the approved T-05 rule end-to-end in the budget path. |
| B-08 | Income does not count against budgets | overall unchanged 0.00 | PASS | fetchExpenseTotals filters kind=expense. |
| B-09 | Edit limit 20000→15000 recomputes | limit=15000, spent 0.00, remaining 15000.00 | PASS | |
| B-10 | Delete removes row; others unaffected | row gone; remaining 2 budgets intact | PASS | UI confirmation dialog is a browser-stage check (later stage). |
| B-11 | Next-month budget via picker window; per-month isolation | created for 2026-12 (picker window 2026-05…2027-04 includes it); current month unaffected | PASS | |
| B-12 | Prior-month expense does not count toward current month | expense dated 2026-10-31; current-month overall stayed 0.00 | PASS | monthRange bounding verified. |
| B-13 | B cannot read/update/delete A's budget; forged user_id insert rejected; B can create own | read/update/delete all zero rows; forged insert → RLS violation; B's own create OK; A's row intact | PASS | WITH CHECK ownership enforced. |
| B-14 | limit 0 / negative / "abc" rejected | all rejected (check constraint / numeric parse error) | PASS | limit_amount > 0 DB-enforced; the app layer additionally rejects non-numeric input before any write. |

## Harness corrections made during the stage (test code only, no app code)

- B-01/B-09/B-13 compared numeric read-backs against decimal strings; PostgREST returns
  JSON numbers (the same trap the Transactions stage documented). Fixed to cent-compare.
- Several probe inserts lacked `.select("id")`, which made the cleanup statements
  dereference `null`. Fixed to select + guard.

## Application-code changes

None. Every budget case passed against the existing implementation; no app code was
modified in this stage.

## Static checks

`npm run typecheck` — pass. `npm run build` — pass (419.29 kB JS bundle).

## Notes for later stages

- The unique-constraint error strings the app maps (budgets_one_overall_per_user_month,
  budgets_one_per_category_month, budgets_limit_amount_check) were observed live in B-03/B-14;
  the friendly-message mapping path itself is a UI-stage check.
- B-13's forged-insert rejection evidence also covers the X-02 pattern for budgets.
