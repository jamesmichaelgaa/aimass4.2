# Stage 6 — Forecast batch results (F-01 … F-15)

Plan: docs/testing-plan-financial.md §6. Contract: docs/salary-reconciliation.md.
Harness: scripts/forecast-tests.mjs — real anon-key clients + real password-auth
sessions (RLS applies exactly as in the app; no service-role key). The forecast
pipeline is mirrored from `src/lib/forecast.ts` (nextPaydayAfter, unpaidBillOccurrences,
findReconcilingSalaryTransaction, bigint-cent assembly) and executed against the REAL
user rows the app would read (schedule, cash, transactions, recurring_bills, bill_payments),
so every assertion runs on production-shaped inputs.

Final tally: **21 PASS / 0 FAIL / 0 BLOCKED.**

## Accounts

| Account | Email | Notes |
|---------|-------|-------|
| A | fxa.20261123-forecast@aimass-test.invalid | NEW disposable account for this stage. Created because txa still holds payment-linked leftovers from the Bills stage (kept until FX-5 teardown), which sat inside every forecast window and inflated all totals. Signup was still rate-limited (429), so the documented SQL-provisioning workaround was reused (below). |
| B | txb.20261122-tx@aimass-test.invalid | Reused deferred account; clean; used for F-15 isolation. |

### Signup rate-limit workaround (reused; two NEW row-shape findings)

The original documented shape still failed with `Database error finding user`. A
column-by-column diff against a real signup row showed two more required values:

- `email_change_token_new` must be `''` (empty string, not NULL)
- `confirmation_sent_at` must be set (NOT NULL)

With those, `signInWithPassword` succeeded. The full working shape is now:
instance_id set, empty-string tokens (confirmation/recovery/email_change/email_change_token_new/
phone_change/reauthentication), `confirmation_sent_at` set, `raw_user_meta_data` with
sub/email/email_verified/phone_verified, matching identity with provider_id = email
and identity_data.sub = user id. Test-environment-only knowledge; production accounts
always come from real signup.

## Results

| ID | Expected | Actual | Status | Evidence / notes |
|----|----------|--------|--------|------------------|
| F-01 | Monthly baseline: cash 8500.00 as of D, salary 25000.00 on payday P → starting 8500.00, ending 33500.00, salary event dated P | ending=33500.00; window (D…P]; expected-salary event on P | PASS | |
| F-02 | Biweekly: forecast window ends on the next payday P; the following progression is exactly P+14 | endDate=P; next progression P+14 | PASS | Plan's original wording ("window ends P+14") described the SECOND payday; corrected expectation documents both hops. |
| F-03 | Payday progression clamps: Jan-31 → Feb-28, → Apr-30 | Jan31→2026-02-28; →2026-04-30 | PASS | Same addMonthsClamped the DB advance_due_date now implements (fixed via migration 20261122120000 in the Bills stage). |
| F-04 | Income dated D+1 counts (ending 35500.00); income dated D does NOT (window strictly after D) | recordedIncome=2000.00; ending=35500.00; D-dated income ignored | PASS | |
| F-05 | Expense dated D+2 counts (ending 33200.00); expense dated D does NOT | recordedExpenses=300.00; ending=33200.00 | PASS | |
| F-06 | Unpaid 500.00 bill due D+5: timeline bill event −500.00; ending 33000.00 | unpaid=1; ending=33000.00; bill event present | PASS | |
| F-07 | Paid occurrence: projected unpaid bill disappears; linked expense counted exactly ONCE — expenses +500.00 AND ending UNCHANGED (bill line −500.00 replaced by actual expense +500.00; no double count) | before unpaid=1 → after unpaid=0; expenseDelta=+500.00; endingDelta=0.00 | PASS | Run in an isolated June-2027 window; deltas make reruns exact. See "permanent rows" note below. |
| F-08 | Exact cents regression guard: 0.07 + 1000.10 − 999.99 + 0.04 = 0.22 exactly; JSON-number payloads safe | ending=0.22; income=1000.10; expense=999.99 | PASS | The earlier `amountToCents` JSON-number crash does not reappear (normalization at the boundary verified in the mirrored pipeline). |
| F-09a | Salary tx dated P, 25000.00, Salary category → reconciled; ending 33500.00; salary line dropped | reconciled=true; ending=33500.00; no expected-salary event | PASS | Income counted once at its actual amount. |
| F-09b | Same dated P−3 (inclusive) → reconciled | reconciled=true; ending=33500.00 | PASS | Required moving the as-of date to P−4 so the P−3 tx sits inside the forecast window — reconciliation only sees transactions the forecast fetches (see harness corrections). |
| F-09c | Same dated P−4 → NOT reconciled | reconciled=false; expected salary still projected | PASS | P−4 tx is outside BOTH the reconciliation window and the forecast window, so it counts zero times; ending 33500.00 with the salary line intact. |
| F-09d | Amount 24999.98 (off by 0.02) → NOT reconciled; both lines count | reconciled=false; ending=58499.98 | PASS | Known overstatement limitation (disclosed in docs/salary-reconciliation.md). |
| F-09e | Amount 24999.99 (off by 0.01, within tolerance) → reconciled | reconciled=true; ending=33499.99 | PASS | Reconciled salary counts at its ACTUAL amount (24999.99), so ending is 8500 + 24999.99 — the plan's flat "33500.00" only holds for exact-amount matches. Harness expectation corrected. |
| F-09f | Category "Other Income", same date/amount → NOT reconciled; both lines count | reconciled=false; ending=58500.00 | PASS | Category guard verified. |
| F-09g | Two qualifying transactions → only ONE reconciles; other counts as ordinary income | reconciled=true; ending=58499.99 (8500 + 25000 + 24999.99) | PASS | Earliest-by-date-then-created_at pick verified. |
| F-10 | Negative projection warning when the projection goes below zero | ending=−900.00; warning "Projected cash goes negative…" present | PASS | Fixture sized 26000.00 (plan's literal 500-bill example stays positive once salary counts). The warning fires on the FINAL projected ending — a mid-window dip below zero alone does not warn (documented behavior). |
| F-11 | Recorded totals equal hand-computed sums (income 14900.50 / expenses 500.00) and ending cash matches exactly (8500 + 14900.50 − 500 + 25000) | income=14900.50; expense=500.00; ending=47900.50 | PASS | Exact match at cent level including .50/.25/.75 parts. |
| F-12 | Cash update via the single upsert path: exactly one cash row; forecast starting cash follows the new value | rows=1; amount=9000.00; startingCash=9000.00 | PASS | Both UI paths (Forecast page + Settings) call the same saveCashPosition upsert; single-row invariant verified. |
| F-13 | Assumptions block inputs all present (period, starting cash, salary treatment, unpaid count, warnings) | all fields present | PASS | "Estimate — not a guaranteed balance" label itself is a browser-stage check; the data contract behind it is verified here. |
| F-14 | No schedule / no cash → forecast unavailable; prompts, no fabricated zeros | cash row absent; schedules=0 | PASS | computeForecast returns ForecastUnavailable (no-cash-position / no-schedule); the UI renders prompts from the same null checks. |
| F-15 | B's forecast reads only B's rows: A's distinct schedule/cash/bills leak nothing | B ending=1000.00 (own inputs only); income=0.00; unpaid=0 | PASS | All context queries RLS-scoped; structurally re-covered by the upcoming X batch. |

## Harness corrections made during the stage (test code only — NO application code changed)

1. **JSON-number comparisons (again):** the mirror compared raw PostgREST JSON numbers
   against `"500.00"`-style strings. Every value is now normalized through the same
   numeric→decimal-string path the app uses before comparison. (Same trap documented in
   the Transactions and Budgets stages.)
2. **Bulk-delete abort semantics:** a `.delete().neq()` that includes ONE
   RESTRICT-referenced row (bill_payments → transactions) aborts the whole statement, so
   nothing in it is deleted. Per-case cleanups now delete their own rows individually and
   report failures into the case's evidence.
3. **F-07 permanent rows:** the RPC-created payment + linked expense are NOT
   client-deletable (bill_payments grants are SELECT-only by design — verified in the live
   security posture). F-07 now runs in a far-future June-2027 window so its leftover rows
   can never contaminate any other case; they are removed at FX-5 account teardown.
   One-time SQL cleanup of the earlier run's leftovers was performed on the test account.
4. **F-09 window semantics:** with payday = today, a P−3-dated transaction sits BEFORE the
   forecast window start (as-of + 1), so reconciliation never sees it. The F-09 series now
   uses as-of = P−4. F-09c additionally documents that a transaction outside the forecast
   window counts zero times (expected salary still projected).
5. **F-09e actual-amount counting:** a reconciled salary counts at its actual amount, not
   the expected amount (33499.99 for a 24999.99 match).
6. **F-10 fixture sizing:** with the plan's literal 100 cash / 500 bill / 25000 salary the
   projected ending is positive (24600.00) and no warning can fire; the bill was sized to
   26000.00 to actually exercise the negative-projection warning. Behavior itself
   (warning on final ending) matches the implementation.
7. **F-02 expectation:** the forecast window ends on the NEXT payday after the as-of date;
   P+14 is the following progression hop, not the window end.

## Static checks (separate from runtime results, per the plan)

- `npm run typecheck`: PASS
- `npm run build`: PASS (no application code was modified in this stage)

## Environment notes

- The bill-deletion UX question raised mid-stage was resolved as working-as-designed:
  bills have no Delete action (payment history must stay intact); Deactivate is the
  removal path. The user explicitly chose to retain the current logic; no code changed.
- Leftover state on account A after the final run: exactly the F-07 trio (1 bill, 1
  payment, 1 linked expense dated 2027-06-05) — client-undeletable by design, removed at
  FX-5. Account B remains clean.
