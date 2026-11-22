# Financial Feature Verification — Test Plan (2026-11-22)

Status: PLAN APPROVED FOR EXECUTION — no application code modified for this plan.
Scope: structured review + runtime test cases for Transactions, Budgets, Recurring Bills, Forecasting, and Settings, per the verification-stage instructions and docs/testing-strategy.md.

## 0. Ground rules (from AGENTS.md and the task)

- Disposable test accounts only. Real-user records are never read, edited, or deleted; probes use test-account rows.
- The service-role key is NEVER used in frontend tests or placed in any client bundle. It exists only server-side (Edge Functions).
- No new features; no rewrites of working code. Failures found by these tests get targeted fixes only.
- Every test case records Expected vs Actual vs Pass/Fail.
- Static checks (typecheck, build) are reported separately from runtime results.
- Accounts: create two fresh accounts (User A, User B) via the real signup flow where possible (dev-project email rate limits may force direct auth-row creation as a fallback — recorded per case). All test data lives under User A/B and is deleted afterward via the account-deletion flow or equivalent cleanup.

## 1. Current verification state (review summary)

| Area | Implemented | Static checks done | Runtime tests |
|---|---|---|---|
| Transactions CRUD + filters + summary | Yes | typecheck+build; schema FK/unique verified | PENDING |
| Categories incl. system-category protection | Yes | typecheck+build; DB checks verified | PENDING |
| Budgets (overall/category, thresholds, month switch) | Yes | typecheck+build; unique partial indexes verified | PENDING |
| Recurring bills CRUD + reminders + RPC mark-paid | Yes | typecheck+build; RPC body/locks verified | PENDING |
| Forecast (deterministic, monthly/biweekly, clamping, reconciliation) | Yes | typecheck+build; 16-case pure-logic check passed | PENDING (explicitly deferred earlier) |
| Settings (schedule + cash editing; Forecast sync) | Yes | typecheck+build; RLS posture verified | PENDING |
| Cross-user RLS isolation | Policies in place | Live policy inspection | PENDING |

Known prior runtime failure already fixed: money arriving as JSON numbers broke `amountToCents` ("could not compute the forecast"); helpers now accept string|number. Test A-F8 below guards the regression.

## 2. Test accounts and fixtures

- FX-1: Sign up User A (test+day+N@aimass-test.invalid). Complete onboarding: profile, salary schedule, cash position. Record actual user id.
- FX-2: Sign up User B likewise. B sets up onboarding with DIFFERENT salary/cash values.
- FX-3: A's baseline data: salary ₱25,000.00 monthly, next payday = a chosen fixed date; cash ₱8,500.00 as of a fixed date.
- FX-4: Known system categories exist for each user after signup (Salary, Others/uncategorized-style defaults) — enumerated once and reused by ID in later cases.
- FX-5: Teardown: delete test users via the delete-account flow (server path) or direct auth-row cleanup; then verify all 8 public tables contain no rows for the deleted ids.

## 3. Transactions (spec 5.3)

Each case: create as User A unless noted.

- T-01 Create income: amount 12500.50, valid date, category Salary. Expect: appears in list; dashboard month income = ₱12,500.50.
- T-02 Create expense: amount 480.25, category Groceries (or first expense category). Expect: listed; month expenses +₱480.25.
- T-03 Amount validation: rejected inputs — "0", "-5", "12,50.00", "abc", "" , "999999999999.995". Expect: inline field error, no row created.
- T-04 Date validation: "2026-02-30", "31/12/2026" (unsupported), future date allowed?, empty date rejected. Expect: per current rules (valid calendar dates only; record actual behavior).
- T-05 Required fields: no category selected (if optional per UI, confirm behavior and record).
- T-06 Edit: change amount 480.25 → 500.00 and date. Expect: list + month summary update (income/expense totals recompute).
- T-07 Delete with confirmation: cancel keeps row; confirm removes row and updates totals.
- T-08 Category assignment: only categories of matching kind are offered (expense picker shows expense categories; income picker shows income categories). Assign a category; verify filter-by-category returns it.
- T-09 Filters: date-range, type, category — each narrows the list; summary respects filters per UI contract (record actual behavior).
- T-10 Monthly summary net: income 12500.50 + 2400.00 − expenses 480.25 + 19.75 → net = 14300.50? Compute expected by hand; expect exact match (cent-safe, no float drift).
- T-11 Description handling: 200+ char note stored and displayed without breaking layout; notes treated as text (no HTML rendering).
- T-12 Cross-user (User B): B cannot see or modify A's transaction by ID (direct API probe with B's session). Expect: empty/error, no data leak.
- T-13 Currency display: amounts render as PHP from profile; no conversion math anywhere.

## 4. Budgets (spec 5.4)

- B-01 Create overall budget for current month, limit 20000.00. Expect: progress card with spent 0, remaining 20000.00, 0%.
- B-02 Create category budget (Groceries, limit 3000.00). Expect: appears; one per category per month enforced.
- B-03 Duplicate prevention: attempt second overall budget same month → UI blocks/mapped error; attempt duplicate category budget → same.
- B-04 Spending calculation: add expenses 1000.00 (Groceries) + 250.00 (Transport, no category budget) → overall spent 1250.00; Groceries spent 1000.00 (6.25% overall; 33.3% groceries). Exact cent match.
- B-05 80% threshold: groceries limit 1000.00, spend 800.00 → "approaching" indicator at ≥80%; 799.99 → NOT approaching.
- B-06 100% threshold: spend 1000.00 → "exceeded"; 1200.00 (over) → "exceeded" with over-amount displayed.
- B-07 Overall budget counts uncategorized/untracked expenses too (spec note): expense with no category counts toward overall.
- B-08 Income does not count against budgets.
- B-09 Edit: change limit 20000 → 15000; spent/remaining/percent recompute.
- B-10 Delete with confirmation; progress disappears; totals unaffected elsewhere.
- B-11 Month switching: create budget for next month (picker +6/−6 range); current month unaffected; switch back and verify per-month isolation.
- B-12 Cross-month totals: expenses in other months do not count toward this month's budgets.
- B-13 Cross-user (B): B cannot read/mutate A's budgets; B's own budgets independent.
- B-14 Invalid inputs: limit 0 / negative / "abc" rejected (limit_amount > 0 DB-enforced).

## 5. Recurring bills (spec 5.5)

- R-01 Create bill: Rent 12000.00 monthly, due fixed date, category Rent. Expect: appears in Upcoming; dashboard reminder within 14 days.
- R-02 Weekly schedule: create 500.00 weekly; verify next-due progression +7 days after payment.
- R-03 Monthly: due on the 31st in a 30/28-day month advances to the last day (clamping) — verify via RPC advance after payment or forecast projection.
- R-04 Quarterly: advances +3 months with last-day clamp; Yearly: +1 year (Feb-29 → Feb-28 on non-leap).
- R-05 Overdue classification: due date in the past → "Needs attention"; due today → same; future → Upcoming.
- R-06 Mark-as-paid (RPC): confirm dialog; pay Rent occurrence on due date without override. Expect: exactly ONE expense transaction created (linked), payment row recorded, next_due_date advanced, dashboard/forecast updated.
- R-07 Amount override: tick "amount differs", pay 11500.00 for a 12000.00 bill. Expect: expense = 11500.00; payment records actual amount; next due still advances.
- R-08 Duplicate payment: repeat mark-as-paid for the SAME occurrence. Expect: friendly "already paid" message; NO second expense; payment count still 1.
- R-09 Payment history: dialog lists due date, paid date, amount, description; matches what was recorded.
- R-10 Bill without payment history can be deleted/deactivated per current UI (record actual: deactivate with confirmation; deactivated bills produce no reminders).
- R-11 Income-category bill: attempt to attach an income category → rejected (assert-category-expense trigger); friendly message.
- R-12 Bill referencing another user's category (forged API probe as B) → rejected by composite FK/ownership.
- R-13 Cross-user (B): B cannot see/pay A's bills; paying A's bill id as B → RPC rejects.
- R-14 Edit bill: change amount/category/due date; list and forecast reflect it.

## 6. Forecasting (spec 5.6, ADR-005, ADR-010, reconciliation contract)

Setup per scenario; cash as-of date D. Window = (D, next payday].

- F-01 Monthly baseline: cash 8500.00 as of D; salary 25000.00 on payday P; no other activity. Expect: starting 8500.00; expected salary 25000.00; estimated ending 33500.00 on P; timeline shows salary event on P.
- F-02 Biweekly: schedule biweekly, next payday P → next progression exactly P+14; window end = P+14.
- F-03 Monthly clamping: payday on the 31st; verify projection lands on Feb 28 (and Apr 30) — nextPaydayAfter math vs DB advance semantics consistent.
- F-04 Recorded income after D: +2000.00 income dated D+1 → ending 35500.00 (with F-01 inputs). Income dated D (on as-of) is NOT counted (window is strictly after D).
- F-05 Recorded expenses after D: −300.00 dated D+2 → ending 33200.00; dated D → not counted.
- F-06 Unpaid bill occurrence: monthly bill 500.00 due D+5 (unpaid) → timeline event, ending −500 → 33000.00.
- F-07 Paid bill exclusion: mark that occurrence paid (RPC created the expense dated e.g. D+5) → the projected occurrence disappears; the recorded expense may count once as recorded activity — verify NOT double-counted (expected: expense counted once total).
- F-08 Exact cents (regression guard): amounts like 0.01/0.05 combos; income 1000.10 + expense 999.99 → net 0.11 exactly; ending cash carries the cent (no float drift). Also confirm the earlier "amount.startsWith" crash does not reappear with JSON-number payloads.
- F-09 Reconciliation (per docs/salary-reconciliation.md contract):
  - F-09a Income, Salary category, dated P, amount 25000.00 → expected salary dropped; income counted once; ending = 8500 + (25000 − 0) = 33500.00 (same number, but "already recorded" label shown, salary line not duplicated).
  - F-09b Same dated P−3 → dropped (window inclusive).
  - F-09c Same dated P−4 → NOT dropped; both lines count (overstates — known limitation, disclosed).
  - F-09d Amount 24999.98 (off by 0.02) → NOT dropped.
  - F-09e Amount 24999.99 (off by 0.01) → dropped (tolerance).
  - F-09f Category "Other Income" same date/amount → NOT dropped.
  - F-09g Two qualifying transactions → only one reconciles; other counts as ordinary income.
- F-10 Negative projection warning: cash 100.00, bills due before payday 500.00 → warning displayed ("Projected cash goes negative").
- F-11 Forecast-vs-actual reconciliation (totals against real records): after recording all activity in a month, dashboard month income/expense/net == hand-computed sums from the transactions list (exact match, including .xx cents).
- F-12 Cash position update via Forecast page and via Settings: change amount/as-of → recompute immediately; verify both paths write the same row (single source).
- F-13 Assumptions block visible: period, starting cash, expected salary treatment, unpaid-bill count, reconciliation note; "Estimate — not a guaranteed balance" label present.
- F-14 Missing inputs: no schedule → prompt to set salary; no cash → prompt to enter cash (no fabricated zeros presented as real).
- F-15 Cross-user (B): B cannot influence A's forecast (reads are RLS-scoped); B's forecast uses B's own inputs.

## 7. Settings (spec 5.9, ties to forecast)

- S-01 Edit salary schedule (amount 25000 → 28000; frequency monthly → biweekly; next payday change). Expect: save succeeds; Forecast page recomputes with new values immediately (F-01 recomputed under new schedule).
- S-02 Invalid schedule inputs: amount 0/negative/invalid; bad date; rejected with field errors; nothing persisted.
- S-03 Edit cash position: change 8500.00 → 9000.00 and as-of date; expect forecast starting cash = 9000.00 and window shift.
- S-04 Zero cash allowed (0.00) — accepted (unlike salary).
- S-05 Cash as-of future date: verify behavior (input clamps to today or is rejected — record actual).
- S-06 Category management: add custom category; use in a transaction; system categories cannot be edited/deleted (no controls; DB enforces).
- S-07 Profile save; currency change attempt AFTER financial records exist → blocked (ADR-011) with clear message.
- S-08 Sign out returns to login; protected routes no longer accessible.

## 8. Cross-user isolation (RLS, testing-strategy §2)

- X-01 For each user-owned table (profiles, categories, transactions, budgets, cash_positions, income_schedules, recurring_bills, bill_payments): as B, attempt SELECT/UPDATE/DELETE on A's rows by id → zero rows/denied.
- X-02 As B, attempt INSERT with user_id = A's id (forged) → rejected by WITH CHECK.
- X-03 Unauthenticated (no token) API call to any table → denied.
- X-04 Cross-user FK: B tries to reference A's category id in a transaction → rejected.
- X-05 Bill payment RPC as B on A's bill → rejected (ownership check inside RPC).
- X-06 A's delete-account flow does not touch B's rows (verified after teardown).

## 9. Static checks (run and reported separately from the above)

- `npm run typecheck` — expected: pass (baseline).
- `npm run build` — expected: pass (baseline).
- Bundle scan: no "SERVICE_ROLE"/"service_role"/"OPENAI_API_KEY"/"sk-" strings in dist output.
- These are NOT substitutes for the runtime cases above.

## 10. Execution order and dependencies

1. Static checks first (§9) — report independently.
2. Fixtures FX-1..FX-5 (two accounts; verify default categories seeded).
3. Transactions (§3) → Budgets (§4) — budgets depend on expense transactions.
4. Bills (§5) — R-06/R-07 create expenses that feed budget/forecast checks.
5. Forecast (§6) — depends on 3–5 data; F-09 series last (each sub-case needs its own payday window reset).
6. Settings (§7) — S-01/S-03 after forecast baselines so the "affects forecast" assertion is observable.
7. Cross-user isolation (§8) — interleave where noted (T-12, B-13, R-13, X-0x).
8. Teardown FX-5; final re-run of static checks if any fix was applied; record results.

## 11. Failure handling

- Any failed case: record Expected vs Actual in tasks.md execution log, diagnose root cause, propose a targeted fix (no refactors), apply only after the failing case is isolated, then re-run the failed case plus its nearest neighbors (e.g. a forecast fix re-runs F-01..F-08).
- If a discrepancy is a documentation-vs-implementation conflict (not a bug), propose a documented resolution per AGENTS.md rather than silently changing either side.
