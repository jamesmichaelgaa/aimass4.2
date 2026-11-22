# Financial Verification — Stage 4 Results (Recurring Bills)

Run date: 2026-11-22. Runner: `scripts/bill-tests.mjs` (same conventions as the
Transactions/Budgets harnesses: real `@supabase/supabase-js` clients on the project's
anon key, real password-auth sessions — every request is RLS-scoped exactly like the
running app; no service-role key used at any point).

Final tallies: **16 PASS, 0 FAIL, 0 BLOCKED** (R-01 … R-14 plus FX-1/FX-2 fixtures),
confirmed stable across four consecutive full runs after the fixes below.

## Accounts

Same deferred accounts as Stages 2–3 (teardown still deferred for the Forecast stage):

- A: `txa.20261122-tx@aimass-test.invalid` (75fff38f-4c1c-4bc8-8988-2aff03815b8b)
- B: `txb.20261122-tx@aimass-test.invalid` (4bf3d2c1-521e-434b-a54a-ae9864bc8ef3)

## Application bug found and FIXED this stage

**Paying a bill due on the 29th–31st of a month failed outright.** The deployed
`advance_due_date` helper caught the wrong SQLSTATE in its month-end clamping loop:
`make_date(2026, 2, 31)` raises SQLSTATE **22008** (datetime field overflow), but the
loop only caught 22003 (`numeric_value_out_of_range`), so the error propagated and the
payment failed with "date field value out of range: 2026-02-31". Any monthly bill due
Jan 29–31, any quarterly bill advancing into a shorter month, and yearly Feb-29 were
unpayable.

**Fix (migration `20261122120000_advance_due_date_clamp_sqlstate_22008.sql`, applied):**
the clamping loop now catches SQLSTATE 22008 (and still 22003 defensively), decrementing
the day until `make_date` succeeds. Verified directly after apply:
monthly Jan-31 → Feb-28, monthly Mar-31 → Apr-30, quarterly Nov-30 → Feb-28,
yearly Feb-29-2028 → Feb-28-2029, weekly unchanged. The migration is idempotent and
preserves the function's `immutable`/`search_path` hardening and existing ACLs
(CREATE OR REPLACE keeps EXECUTE revoked from public/anon, granted to authenticated).

This matches the documented contract (docs/testing-plan-financial.md R-03/R-04) and the
application-side forecast mirror (`addMonthsClamped`), which was already correct.

## Bills batch (R-01 … R-14)

| ID | Expected | Actual | Status | Evidence / notes |
|----|----------|--------|--------|------------------|
| R-01 | Rent 12000.00 monthly, active, due in 10 days | created with exact cents, active | PASS | 14-day reminder window is a UI-stage check; the data state is verified here. |
| R-02 | Weekly bill pays then advances exactly +7 days | 2026-11-22 → 2026-11-29 | PASS | |
| R-03 | Monthly Jan-31 occurrence clamps to Feb 28 | paid; next = 2026-02-28 | PASS | Passed only after the SQLSTATE-22008 migration above; the first run failed with the raw DB error. |
| R-04 | Quarterly +3mo clamp; yearly Feb-29 → Feb-28 | Nov-30 → 2027-02-28; Feb-29-2028 → 2029-02-28 | PASS | Same fix as R-03. |
| R-05 | Past-due bill classifies as overdue | row dated 2026-11-19 < today | PASS | billStatus is a pure frontend comparator; the data layer confirms the persisted past date. |
| R-06 | Pay due occurrence: exactly ONE linked expense (12000.00, dated due date, Rent category), ONE payment row, due date advanced +1 month | 1 new expense linked via payment row; payments=1; next=2027-01-02 | PASS | Atomic RPC path; occurrence uniqueness separately proven by R-08. |
| R-07 | Override 11500.00 on a 12000.00 bill: expense = 11500.00; due still advances | expense 11500; next advanced correctly | PASS | |
| R-08 | Duplicate payment for the SAME occurrence rejected; no second expense | rejected ("this bill occurrence has already been paid"); tx delta 0; payments still 1 | PASS | App maps this to the "already paid" message. |
| R-09 | Payment history lists due date, amount, description, transaction date | due=occurrence date, amount 12000, desc + date present | PASS | Same join shape as the app's fetchBillPayments. |
| R-10 | Deactivation persists; inactive bill drops out of reminders; RPC refuses to pay | is_active=false; excluded from active list; pay rejected ("not active") | PASS | |
| R-11 | Bill with an INCOME category rejected | rejected (assert-category-expense trigger) | PASS | |
| R-12 | B attaching A's category id to B's bill rejected | rejected (same-user composite FK/trigger) | PASS | |
| R-13 | B cannot read A's bill; RPC as B on A's bill rejected; A's payment count unchanged | read zero rows; pay rejected ("recurring bill not found" — no existence leak); payments still 1 | PASS | Covers X-05 for the RPC ownership check. |
| R-14 | Edit amount/category/due date persists | amount 13000, new category + date read back | PASS | Forecast reflection of edited values is covered in the Forecast stage. |

## Harness corrections made during the stage (test code only, no app code)

- Start-of-run and end-of-run cleanups originally deleted bills before payment rows;
  `bill_payments` RESTRICT-references bills (by design), so cleanup now deletes
  payments → bills → transactions in dependency order. The same ordering was needed for
  the manual one-off cleanup of rows stranded by the pre-fix clamping failure.
- The "Rent" fixture was originally resolved by name; a previous failed run's leftovers
  made that ambiguous. Now pinned to the id created in R-01.
- R-07 now delta-counts the override expense instead of assuming a unique description:
  payment-linked transactions from earlier failed runs are intentionally NOT deletable
  client-side (bill_payments is read-only for clients by design — docs/sql-migration-plan.md
  §"no direct client delete"; the payment RPC is the only write path). These leftovers
  are removed at final account teardown (FX-5) instead.

## Application-code changes this stage

One migration only (`advance_due_date` SQLSTATE fix above). No frontend code changes.

## Static checks

`npm run typecheck` — pass. `npm run build` — pass (419.29 kB JS bundle).

## Notes for later stages

- Leftover bill payment rows from the pre-fix failed runs remain on account A until
  final teardown; they do not affect the Forecast stage's assertions (which clean
  transactions and use fresh bills).
- R-13's "recurring bill not found" response for foreign bills also covers the
  no-existence-leak property.
