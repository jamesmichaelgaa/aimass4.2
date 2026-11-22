# Development Tasks — aimass4.2

## Phase 0 — Product and repository foundation
- [x] Create private GitHub repository.
- [x] Draft and finalize MVP product scope.
- [x] Define agent instructions and security policy.
- [x] Document architecture and proposed database design.
- [x] Confirm salary schedules: monthly and biweekly.
- [x] Confirm reminders: in-app only.
- [x] Confirm AI MVP capabilities: insights, recommendations, forecast explanations, and chat.
- [x] Defer subscription pricing and PDF reports.
- [x] Create user flows, AI agent specification, and testing strategy.
- [x] Review and approve the MVP database design.
- [x] Document SQL migration sequence and RLS security model.
- [x] Approve SQL migration and RLS implementation plan.
- [ ] Enable GitHub secret scanning and push protection where available.
- [ ] Connect repository to Bolt without overwriting documentation.

## Phase 1 — Frontend foundation
- [x] Scaffold React + TypeScript + Vite application.
- [x] Establish routing, layout, responsive navigation, and design system.
- [x] Build onboarding and authentication screens (sign up, sign in, password recovery request, sign out; three-step onboarding: profile, salary schedule, cash position).
- [x] Build dashboard shell with loading, empty, and error states.
- [x] Add lint, typecheck, test, and production build scripts (typecheck + build scripts added; lint and test scripts pending test framework setup).
- [ ] Add GitHub Actions CI using actual package scripts.

### Phase 1 verification status (2026-11-22)
Typecheck and production build pass; the bundle was scanned and contains no service-role or OpenAI strings. Auth and onboarding write paths use the existing tables and RLS. NOT yet verified in a browser (no browser tooling in this environment): real signup/login round-trip, onboarding saves, redirect behavior, and mobile rendering. Do not mark auth "tested" until a browser session or end-to-end test confirms it.

## Phase 2 — Supabase foundation
- [x] Create a new Supabase development project (Bolt-provisioned Supabase project in use).
- [ ] Configure Auth providers and redirect URLs.
- [x] Create and commit SQL migrations (applied 2026-11-22 via the Supabase migration tool; exact applied SQL archived under docs/sql/migrations/ — ten applied files covering eight logical changes; see docs/sql-migration-plan.md "Implemented status").
- [x] Enable RLS on every user-owned table.
- [x] Add owner-scoped policies and validate foreign-key ownership (composite FKs: transactions same-owner/same-kind; budgets and bills same-owner; expense-kind validation triggers).
- [x] Add indexes, constraints, and safe monetary data types (all money is numeric(14,2)).
- [ ] Implement and test signup initialization (trigger deployed; runtime testing PENDING — do not mark complete until tests pass).
- [ ] Implement and test atomic bill-payment RPC (implemented as `mark_bill_occurrence_paid`; runtime testing PENDING — do not mark complete until tests pass).
- [ ] Test cross-user access isolation and direct-write denial (PENDING).
- [x] Apply currency-rule correction migration (ADR-011: allow currency change before financial records exist; block after — applied and behavior-tested 2026-11-22; two-session concurrency race and bill-payment-path verification remain pending in the runtime test list).

### Migration delivery note (deviation from ADR-004, approved 2026-11-22)
The Supabase CLI is unsupported in this environment and files written to `supabase/migrations/` are not executed, so migrations were applied directly through the Supabase migration tool and are recorded in the database's migration history. The exact applied SQL is archived under `docs/sql/migrations/` so GitHub remains the source of truth for project source, documentation, and migration SQL per ADR-004. Document future schema changes as migrations applied through the same tool, then archive the applied SQL here.

### Currency rule correction (ADR-011, applied and behavior-tested 2026-11-22)
The conditional currency rule is implemented: changes are allowed before any financial records exist and blocked once transactions, bill payments, or budgets exist. Concurrency-safe via profile-row FOR SHARE locks taken by record-creating triggers. Behavior verified live (allowed with zero records; blocked with a transaction or budget; restored after deletion; other profile fields unaffected). Still pending in runtime tests: the two-session race case and the bill-payment path.

### Salary reconciliation flag (Phase 3 prerequisite)
The forecast's expected-vs-actual salary matching rule is application logic and was NOT implemented in these migrations. Define and test it before building the forecast feature (docs/sql-migration-plan.md section 9).

## Phase 3 — Core budgeting features
- [ ] Profile, preferred currency, timezone, and cash position/as-of date.
- [ ] Onboarding for monthly/biweekly salary and next payday.
- [x] Manual income and expense tracking (implemented 2026-11-22; browser round-trip testing PENDING — see Phase 2A status below).
- [x] Default and custom categories (implemented 2026-11-22: management UI in Settings; browser round-trip testing PENDING).
- [ ] Overall and category monthly budgets.
- [ ] Dashboard income, expenses, cash position, and budget progress.
- [ ] Recurring bill setup and recurrence rules.
- [ ] In-app upcoming and overdue bill reminders.
- [ ] Mark bill occurrence paid and prevent duplicate expense counting.
- [ ] Deterministic payday/cash-flow forecast with visible assumptions.
- [ ] Settings and account/data management.

### Phase 2A status (2026-11-22): transactions and categories UI
Implemented: full transaction CRUD (add income/expense, edit, delete with confirmation), filters (date range, type, category), date-range summary (income/expenses/net via exact decimal-string cent arithmetic), current-month dashboard summary plus five most recent transactions, and category management (add custom income/expense categories; default/system categories have no edit or delete controls and the database forbids modifying or deleting them). No new tables or migrations; existing transactions/categories tables and owner-scoped RLS policies are used as-is. Amounts are validated as decimal strings and persisted to numeric without binary-float conversion. Currency shown from the user's profile.
Verification: `npm run typecheck` and `npm run build` pass. Database integrity confirmed via schema inspection: transactions.category composite FK (user_id, category_id, kind) → categories(user_id, id, kind) enforces category ownership AND type match; unique index on (user_id, lower(name), kind) blocks duplicate category names; RLS owner policies on both tables. Still pending: interactive browser testing (signup → add income/expense → edit → delete → filters → totals) and a live RLS cross-user probe; test framework not installed (no existing one; adding Vitest would be a new dependency — deferred unless requested).

### Phase 2B status (2026-11-22): monthly budgets
Implemented on the existing budgets table (no migrations): Budgets page with a rolling month picker (6 back / 6 forward), overall budget (one per month, edit only — no duplicates), category budgets for expense categories only (one per category per month), edit, and delete with confirmation. Progress bars show spent vs. limit, percentage used, and remaining; indicators flag "approaching" at ≥80% and "exceeded" at ≥100%. Spending comes from actual expense transactions in the selected month only (exact bigint cent arithmetic; untracked expenses still count against the overall budget). Dashboard shows the current month's budget list with the same progress/warning states. Empty, loading, success, and error states throughout; duplicate-budget and invalid-amount attempts surface user-friendly messages mapped from the database's unique partial indexes and checks.
Verification: `npm run typecheck` and `npm run build` pass. Schema inspected live: partial unique indexes budgets_one_overall_per_user_month and budgets_one_per_category_month enforce the one-per-month rules; budgets_month_check pins budgets to the first of the month; the (user_id, category_id) FK enforces category ownership; limit_amount > 0 is database-enforced. Still pending: interactive browser testing (create overall → create category budgets → edit → delete → month switching → totals correctness) and a live RLS cross-user probe. No test framework added (none pre-existing; new dependency requires approval).

### Phase 2C status (2026-11-22): recurring bills and in-app reminders
Implemented on the existing recurring_bills and bill_payments tables (no migrations): Bills page with add/edit forms (name, decimal amount, weekly/monthly/quarterly/yearly frequency, next due date, optional expense category), sections for "Needs attention" (overdue + due today), "Upcoming", and "Inactive" bills, edit, deactivate-with-confirmation (no deletes; history preserved), and per-bill payment history dialog (due date, paid date, amount, description from the linked expense). Mark-as-paid requires confirmation and calls ONLY the existing mark_bill_occurrence_paid RPC (signature verified against the live function) with optional amount-override and description; the frontend never inserts into bill_payments or pre-creates the expense — the RPC creates/links the expense, records the payment, and advances next_due_date (with last-day clamping via advance_due_date) atomically. Duplicate payment attempts map to a clear message ("already paid") and the list refreshes; the RPC's FOR UPDATE lock and unique (recurring_bill_id, due_date) index provide the server-side guarantee. Dashboard shows the next 14 days of active bill reminders with overdue/due-today emphasis. Deactivated bills generate no reminders. All amounts are decimal strings end to end.
Verification: `npm run typecheck` and `npm run build` pass. STRUCTURAL checks only, performed live: RPC signature and body inspected (ownership check, active check, occurrence-order check, prior-payment check, expense-category validation, atomic insert/update); unique one-payment-per-occurrence index confirmed; recurring_bills frequency CHECK allows exactly the four supported values; category FK enforces ownership and the assert-category-expense trigger blocks income categories. NOT yet exercised at runtime: actual mark-paid call (expense creation, due-date advancement, clamping), duplicate-payment rejection against a real session, edit flows, and cross-user RLS isolation — these need a signed-in browser session or scripted auth client; do not treat as complete until then.

## Phase 4 — AI assistant
- [ ] Create authenticated Supabase Edge Function.
- [ ] Store OpenAI API key as a Supabase Edge Function secret.
- [ ] Retrieve only minimal, authenticated user-scoped summaries.
- [ ] Implement spending insights.
- [ ] Implement budget and savings recommendations.
- [ ] Implement explanations of deterministic cash-flow forecasts.
- [ ] Implement conversational budgeting Q&A.
- [ ] Add rate limits, usage controls, and safe error handling.
- [ ] Keep AI read-only; no autonomous record changes.
- [ ] Test prompt injection in transaction notes and malformed requests.

## Phase 5 — Quality and security
- [ ] Unit tests for money, budget, recurrence, and forecast calculations.
- [ ] Component and end-to-end tests for critical user journeys.
- [ ] RLS integration tests for every user-owned table.
- [ ] Verify no secrets in Git history or frontend build output.
- [ ] Dependency/security review.
- [ ] Accessibility and mobile/desktop checks.
- [ ] Production build and smoke tests.

## Phase 6 — Launch
- [ ] Configure production Supabase project and secrets.
- [ ] Configure Bolt Hosting environment variables.
- [ ] Apply production migrations.
- [ ] Deploy and verify public URL.
- [ ] Verify authentication, transaction CRUD, budgets, bills, forecasts, and AI.
- [ ] Document release, backup, recovery, and support procedures.

## Deferred — Post-MVP
- [ ] Subscription pricing, payments, and premium feature gating.
- [ ] PDF financial reports/export.
- [ ] Email and push notifications.
- [ ] Bank/e-wallet integrations (separate security and feasibility review).
- [ ] Automatic AI expense categorization.
- [ ] Weekend/holiday payday adjustment.
