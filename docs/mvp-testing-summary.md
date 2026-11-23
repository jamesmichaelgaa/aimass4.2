# MVP Runtime Verification — Final Summary (docs/testing-plan-financial.md)

Date: 2026-11-23. All stages executed per the plan's execution order (§10) and
failure policy (§11). Ground rules held throughout: no new features, no
refactors, targeted fixes only for genuine failures; Expected vs Actual vs
Pass/Fail recorded per case; static checks reported separately; the
service-role key was never used in tests (real anon-key clients + real
password-auth sessions, so RLS applied exactly as in the running app); all
test accounts were disposable and have been torn down (FX-5, below).

## Final tally by stage

| Stage | Cases | Result | Results file |
|-------|-------|--------|--------------|
| 1. Environment (FX-1/2/4) | 3 | 3 PASS | docs/testing-results-transactions.md |
| 2. Transactions T-01…T-13 (+T-03b) | 18 | **18 PASS / 0 FAIL** (after T-03 fix + rerun) | docs/testing-results-transactions.md |
| 3. Budgets B-01…B-14 | 17 | **17 PASS / 0 FAIL** | docs/testing-results-budgets.md |
| 4. Recurring Bills R-01…R-14 | 16 | **16 PASS / 0 FAIL** (after one real DB bug fixed) | docs/testing-results-bills.md |
| 5. AI Assistant A-00…A-10 | 11 | **11 PASS** | docs/testing-results-ai.md |
| 6. Forecast F-01…F-15 | 21 | **21 PASS / 0 FAIL** | docs/testing-results-forecast.md |
| 7. Security X-01…X-06 | 10 | **10 PASS / 0 FAIL** | docs/testing-results-security.md |

**Total: 96 case records, all PASS at completion; 0 FAIL; 0 BLOCKED.**

## Genuine defects found and fixed (application/database code)

1. **Money-parsing 100× risk (T-03, Transactions stage):** the app's amount
   parser stripped ALL commas before validating, so `12,50.00` (comma as
   decimal separator) was silently parsed as 1250.00 — a potential 100× money
   error. Fixed: comma grouping is now validated by one shared helper
   (`hasValidCommaGrouping`) used by Transactions, Bills, Budgets, Settings
   salary, and Cash so the rule cannot drift; ambiguous groupings are rejected
   with no silent conversion. Regression probes added to the harness.
2. **`advance_due_date` SQLSTATE bug (Bills stage, real DB defect):** the
   month-end clamping loop caught SQLSTATE 22003 but `make_date` raises 22008,
   so ANY bill due on the 29th–31st could never be marked paid ("date field
   value out of range"). Fixed via migration
   `20261122120000_advance_due_date_clamp_sqlstate_22008.sql` (applied,
   idempotent); verified Jan-31→Feb-28, Mar-31→Apr-30, quarterly Nov-30→Feb-28,
   yearly Feb-29→Feb-28.
3. **JSON-number money crash (root-caused earlier, regression-guarded here):**
   PostgREST returns numeric(14,2) as JSON numbers while `amountToCents` was
   string-only. The app fix normalizes at the boundary; every later stage's
   harness asserts this end to end (T-06, B-01/B-09/B-13, F-08, X-01).

Documented-not-defects: T-05 category-optional behavior (approved as intended),
F-09 known false-negative reconciliation limitation (disclosed in
docs/salary-reconciliation.md), AI A-04 reply reflecting leftover test data
(not a defect).

## What was verified, in one line each

- **Transactions:** CRUD round-trips, exact-cent persistence and totals, date/
  type/category filters, invalid inputs (amounts, dates), DB checks (amount>0,
  numeric(14,2) overflow), category-kind composite FK.
- **Budgets:** overall + category CRUD, one-per-month unique rules, exact-cent
  progress math, 80%/100% thresholds, uncategorized-expenses-lift-overall-only,
  cross-month isolation, invalid-limit rejection.
- **Bills:** CRUD + edit persistence, weekly/monthly/quarterly/yearly
  progression with clamping, overdue/due-today classification, atomic
  mark-paid (single expense + advance + no double count), amount override,
  duplicate-payment rejection, payment history, deactivation, income-category
  rejection, cross-user RPC denial without existence leak.
- **Forecast:** monthly/biweekly baselines, window strictly after as-of, clamps,
  unpaid-bill projection, paid-bill exclusion with no double counting, exact
  cents (0.07 + 1000.10 − 999.99 + 0.04 = 0.22), the FULL salary-reconciliation
  contract (F-09a–g), negative-projection warning, single-source cash upsert,
  unavailable-forecast prompts, cross-user isolation.
- **AI assistant:** unauthenticated 401 (gateway + in-function verification),
  payload validation, grounded aggregate-only answers, cross-user isolation,
  read-only refusals, prompt-injection failure, rate limiting (10/60s verified
  by direct probes), no key/secret literals, no eval/write sinks.
- **Security:** cross-user SELECT/UPDATE/DELETE denied on all 8 tables with
  REAL row ids (19/19), forged user_id inserts rejected 5/5, anon denial 8/8,
  cross-user FK rejection, RPC ownership, and the full account-deletion
  round-trip (invalid token 401, real deletion 200, sign-in after deletion
  fails, ZERO rows remain across all 8 tables + auth row, other users intact).

## Static checks (reported separately, per plan)

`npm run typecheck` and `npm run build` re-verified passing at the end of every
stage that touched files; final bundle 419.29 kB (gzip 116.90 kB) with no
service-role or API-key strings. No lint/test framework exists (adding one is a
new dependency and was not approved); harnesses are standalone Node scripts.

## Environment notes (reproducibility)

- Signup rate limiting (429) on the dev project blocked direct account
  creation; accounts were provisioned by SQL into auth.users/auth.identities
  with the exact real-signup row shape and signed in through the real password
  API. Full required shape documented in
  docs/testing-results-transactions.md and extended in
  docs/testing-results-forecast.md (`email_change_token_new = ''`,
  `confirmation_sent_at` NOT NULL). Test-environment-only; production accounts
  are unaffected.
- The dev Vocareum AI gateway and dev SMTP rate limits are environment
  constraints, not app defects; revisit for production (Phase 6).

## FX-5 — Account teardown (executed 2026-11-23)

Deleted the auth rows for txa, txb, and fxa (the documented GoTrue-safe path;
database-enforced cascade removed every owned record, including the otherwise
client-undeletable payment-linked leftovers on txa and fxa). fxdel was already
gone via the X-06 deletion round-trip. Verified afterwards: ZERO orphan rows
across profiles, categories, transactions, budgets, cash_positions,
income_schedules, recurring_bills, bill_payments; the real user's account and
its 9 default categories intact.

## Remaining known gaps (not blocking this plan; tracked in tasks.md)

- Browser-stage checks that this environment cannot perform (no browser
  tooling): full signup→onboarding→login visual round-trip, mobile rendering,
  reset-password email deliverability end-to-end, ADR-011 two-session currency
  race, XSS/visual confirmation dialogs.
- Password reset flow: page implemented and structurally verified; live
  email-link round-trip still needs working SMTP.
- AI forecast explanations remain intentionally unwired pending product
  decision (Phase 4 line item).
- Git-history secret scanning and CI config deferred until a remote exists
  (workspace is not a git repository).
