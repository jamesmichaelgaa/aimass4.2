# Financial Verification — Stage 2 Results (Transactions)

Run date: 2026-11-22. Runner: `scripts/tx-tests.mjs` (real `@supabase/supabase-js` clients, the project's
anon key, real password-auth sessions — every request is RLS-scoped exactly like the running app;
no service-role key used at any point).

Test accounts (disposable, test-only):

- A: `txa.20261122-tx@aimass-test.invalid` (75fff38f-4c1c-4bc8-8988-2aff03815b8b)
- B: `txb.20261122-tx@aimass-test.invalid` (4bf3d2c1-521e-434b-a54a-ae9864bc8ef3)
- Password: test-only value held in the harness file; accounts contain no real data.
- Teardown path: delete both `auth.users` rows; all public tables cascade (verified FK topology).
  Cleanup intentionally deferred so Budgets/Bills/Forecast stages can reuse the same accounts.

## Stage 1 — environment preparation

| ID | Result | Evidence |
|----|--------|----------|
| FX-1 | PASS | Pre-provisioned auth row; `signInWithPassword` returned an active session for A. |
| FX-2 | PASS | Same for B. |
| FX-4 | PASS | A and B each see exactly their own 9 default categories (2 income, 7 expense); the unauthenticated client is denied (`permission denied for table categories`) — correct deny-by-default for a sign-in-only app. |

### Signup rate-limit workaround (documented for reproducibility)

Direct signup is blocked by the dev project's email rate limit (429). Accounts were provisioned by SQL
into `auth.users` + `auth.identities` and sessions were obtained through the real password-auth API.

Important finding from unblocking this: GoTrue rejects hand-made rows unless they match the exact shape
a real signup produces. Initial attempts failed with `500 Database error querying schema`. Comparing
column-by-column against a real signup-created user in this project showed the working shape:

- `instance_id = '00000000-0000-0000-0000-000000000000'` (GoTrue's login lookup filters on this value; NULL rows are never found)
- `confirmation_token = ''`, `recovery_token = ''` (empty strings, not NULL)
- `raw_user_meta_data` containing `sub`, `email`, `email_verified`, `phone_verified`
- identity `provider_id` = the email, `identity_data.sub` = user id, `email_verified: true`
- bcrypt hash `$2b$10$...`, 60 chars (note: a prior phase-4 hand-made user has NULL tokens, NULL
  instance_id and `provider_id='email'`; that row shape does not authenticate either — it currently
  returns invalid-credentials on any password)

This is test-environment-only knowledge; production accounts always come from real signup and are unaffected.

## Stage 2 — Transactions batch (T-01 … T-13)

Final tallies: **17 PASS, 1 FAIL, 0 BLOCKED** (T-03 is the failing case; T-03b passes).

| ID | Expected | Actual | Status | Evidence / notes |
|----|----------|--------|--------|------------------|
| T-01 | Income 12500.50 created, exact cents on read-back | amount=12500.5 returned; harness cent-compare equals 1250050 | PASS | PostgREST returns numeric as JSON number; cent comparison confirms exactness. |
| T-02 | Expense 480.25 created, exact cents | amount=480.25, 48025 cents | PASS | |
| T-03 | All invalid amounts rejected before persistence | zero/negative rejected by DB check; non-numeric/empty rejected by app format validation; **malformed "12,50.00" accepted by app parsing** | **FAIL** | See failure analysis below. DB layer behaved correctly (amount > 0 check fired for both). |
| T-03b | Overflow beyond numeric(14,2) rejected or safely rounded | rejected by DB | PASS | 999999999999.995 rejected. |
| T-04 | Invalid dates rejected; future-date behavior documented | 2026-02-30, 31/12/2026, 2026-13-01, empty all rejected at app validation; future date accepted (per app rules) | PASS | |
| T-05 | Category-optional behavior documented | transaction with null category ACCEPTED (category_id nullable) | PASS (documented) | Product decision needed on whether optional categories are intended; spec 5.3 ambiguous. |
| T-06 | Edit 480.25→500.00 + date change; read-back correct | amount=500, date=2026-11-23 | PASS | |
| T-07 | Delete removes row; totals recompute | row gone after delete | PASS | UI confirmation dialog is a browser-stage check, not testable here. |
| T-08a | Expense with income category rejected | rejected (composite FK kind mismatch) | PASS | |
| T-08b | Category filter returns only that category | 1 row, all match | PASS | |
| T-09 | Date/type/category filters narrow correctly | all three behaved as expected | PASS | |
| T-10 | income=14900.50 expense=500.00 net=14400.50 exact | exact match at cent level | PASS | Cross-checks `sumAmounts` semantics with bigint-cent harness math. |
| T-11 | 250-char description stored intact | stored and read back intact | PASS | React escapes text nodes; XSS is a browser-stage check. |
| T-12 | B cannot read/update/delete A's row; A's data intact | read/update/delete all returned zero rows; A's row intact at 12500.50 | PASS | Owner-scoped RLS enforced for all three verbs. |
| T-13 | Currency is profile-level display only | A preferred_currency=PHP; no conversion server-side | PASS | |

## T-03 failure analysis (the one genuine FAIL)

Input `12,50.00` (comma used as decimal separator, malformed in either grouping convention) is
accepted by the app's amount parser. Root cause: the parser strips ALL commas before validating
(`raw.replace(/,/g, "")`), so `12,50.00` becomes `1250.00` and passes as a valid amount. The same
logic correctly accepts `1,250.00` (standard thousands grouping), which is presumably why the
strip-all-commas approach was taken.

Impact: a user typing `12,50.00` (meaning 12.50, European/PH-market style) will silently record
1250.00 — a 100x error. The DB is not at fault; the check constraint and numeric(14,2) both behaved.

Suggested fix direction (for review, NOT implemented per stage rules): reject amounts where a comma
is NOT followed by exactly 3 digits (i.e. allow `1,250.00` and `1,250,000.00` but reject `12,50.00`).
No code change was made in this stage.

## Harness corrections made during the stage (test code only, no app code)

- T-06 compared the returned numeric against the string `"500.00"`; PostgREST returns JSON numbers.
  Fixed to compare in cents.
- T-09's category filter compared `category_id` without selecting it. Fixed to select + compare.
- T-12 depended on a fixture row that T-10's baseline cleanup deleted. Moved to a dedicated
  per-run isolation fixture.
- FX-4 originally marked the anon denial as a failure; denial is the intended behavior, so the
  check now asserts denial.

## Open items for review before the Budgets stage

1. T-03 FAIL — comma-as-decimal acceptance (above). Needs a product/code decision.
2. T-05 — confirm whether transactions without a category are intended (spec ambiguity).
3. The phase-4 test account (`aimass.phase4.test@gmail.com`) is a leftover hand-made auth row that
   cannot authenticate; recommend deleting it during final cleanup.
