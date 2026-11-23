# Stage 7 — Security batch results (X-01 … X-06)

Plan: docs/testing-plan-financial.md §8. Harness: scripts/security-tests.mjs —
real anon-key clients + real password-auth sessions; no service-role key.
Accounts: A = fxa.20261123-forecast (forecast stage), B = txb.20261122-tx (clean),
D = fxdel.20261123-delete (dedicated deletion victim, SQL-provisioned like fxa
because signup stays rate-limited; same verified row shape as documented in the
forecast results file).

Final tally: **10 PASS / 0 FAIL / 0 BLOCKED** (X-06d verified by SQL immediately
after the run; recorded as its own evidence below).

| ID | Expected | Actual | Status | Evidence / notes |
|----|----------|--------|--------|------------------|
| X-01 | All 8 tables (profiles, categories, transactions, budgets, cash_positions, income_schedules, recurring_bills, bill_payments): B's SELECT/UPDATE/DELETE against A's rows return zero rows / denied; A's rows intact afterwards | 19/19 sub-checks denied; A's fixture transaction + budget read back intact | PASS | Fixture rows created on A; B probed each table with A's REAL row ids (not guessed). Profile update probe uses id = auth uid. |
| X-02 | A cannot insert rows forged with B's user_id (WITH CHECK rejects) | 5/5 rejected (transactions, budgets, income_schedules, recurring_bills, cash_positions) | PASS | Payloads carried B's real auth uid. |
| X-03 | Unauthenticated (anon-key, no session) client sees zero rows or is denied on all 8 tables | 8/8 denied/empty | PASS | Consistent with the live security posture: anon holds no table grants on user-owned tables. |
| X-04 | A cannot create a transaction referencing B's category | rejected by FK | PASS | Composite FK (user_id, category_id, kind) → categories enforces same-owner. |
| X-05 | B cannot pay A's bill via mark_bill_occurrence_paid: denied, no existence leak, A's bill unchanged | denied; A's bill unchanged | PASS | Primary live coverage remains R-13 (docs/testing-results-bills.md); re-asserted here. |
| X-06a | Wrong/invalid token cannot delete an account | HTTP 401 | PASS | Bogus bearer rejected by the edge function before any deletion. |
| X-06b | Real authenticated deletion (fresh verified session token) succeeds | HTTP 200 {deleted:true} | PASS | Called the deployed delete-account function directly with D's fresh token. |
| X-06c | Deleted account cannot sign in again | invalid credentials | PASS | |
| X-06d | All 8 tables lose the deleted user's rows; another user's rows survive | SQL verification: profiles 0, categories 0, transactions 0, budgets 0, cash_positions 0, income_schedules 0, recurring_bills 0, bill_payments 0; auth row gone; B's 9 default categories intact | PASS | Cascade verified via SQL immediately after deletion (client-side probing impossible after the token dies). |
| X-06e | B's rows and 9 default categories survive the whole run | 9 categories; no errors | PASS | |

## Auth-flow notes for this stage

- Wrong-password rejection and "deleted account can't sign in" are covered by
  X-06a/X-06c against real auth endpoints.
- Password reset flow remains a browser/SMTP-stage item (dev SMTP rate limit
  documented earlier; the /reset-password page implementation is verified
  structurally in tasks.md, not re-tested here).

## Harness corrections made during the stage (test code only — NO application code changed)

1. JSON-number comparison in the intact check (limit_amount returns 100, not
   "100.00") — same recurring trap as T-06/B-01/B-09/B-13/F-series.
2. `select("id")` then `.find(c => c.name === ...)` — name was never selected, so
   the lookup was always undefined and crashed X-04/X-05. Fixed to select id+name.
3. Section wrapper added so one crashed probe records FAIL instead of aborting
   the run (an earlier abort left a leftover budget that then tripped the
   one-overall-per-month unique index on rerun; fixture insert now reuses it).

## Static checks (separate from runtime results, per the plan)

- `npm run typecheck`: PASS · `npm run build`: PASS (no application code changed
  in this stage).
