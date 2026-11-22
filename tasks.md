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

### Phase 3 status (2026-11-22): deterministic payday/cash-flow forecast
Prerequisite FIRST: the salary reconciliation rule is now defined in `docs/salary-reconciliation.md` — an income transaction reconciles the expected payday occurrence only when it is categorized under the user's system "Salary" category AND dated within [payday − 3 days, payday] AND within one centavo of the expected amount; a match drops the expected-salary line so income is never double-counted, and one occurrence per window reconciles. Known false-negative limitation (salary recorded under another category) and a proposed future exact-link column are documented there; no schema change was made.

Implemented (no new tables, no snapshots persisted, no AI): Forecast page showing starting cash + as-of date, forecast window (day after as-of through next payday inclusive), expected salary (labelled "not yet received", or "already recorded — not counted twice" when reconciled), recorded income and expenses strictly after the as-of date, upcoming unpaid bill occurrences (paid ones represented only by their linked expense, never subtracted twice), estimated ending cash, a chronological timeline of forecast events, warnings (negative projection, reconciliation applied, unpaid-bill count), and a stated assumptions box. Editable cash position/amount on the page recalculates. Dashboard gained a concise "Forecast through your next payday" card labelled as an estimate. All arithmetic is bigint cent-based application logic; monthly salary uses calendar-month progression with last-day clamping, biweekly exactly 14 days; bill occurrence projection mirrors the database's advance_due_date semantics.
Verification: `npm run typecheck` and `npm run build` pass. A 16-case logic check of the pure arithmetic passed (monthly Jan-31→Feb-28, Aug/Sep, Oct-31→Nov-30, Dec-31→Jan-31, quarterly and yearly clamping incl. leap-year Feb-29, biweekly +14 across year boundary, decimal addition/subtraction with negative results, reconciliation ±0.01 tolerance in/out). RESOLVED 2026-11-22: the user-reported "could not compute the forecast" was root-caused to money values arriving from the data API as JSON numbers while `amountToCents` was string-only (`amount.startsWith is not a function`); the fix makes `amountToCents`/`addSignedAmounts`/`diffAmounts`/`sumAmounts` accept `string | number` and `computeForecast` normalizes the schedule, cash position, transaction, and bill amounts at the boundary. The forecast page issue is fixed; FORECAST RUNTIME AND FINANCIAL CORRECTNESS VERIFICATION (end-to-end computation against live data in a signed-in session, paid-bill exclusion, reconciliation against real transactions, cash-position update path, RLS scoping, and the full reconciliation test contract in docs/salary-reconciliation.md) REMAINS A SEPARATE PENDING TESTING ITEM and does not block other work.

### Phase 2C status (2026-11-22): recurring bills and in-app reminders
Implemented on the existing recurring_bills and bill_payments tables (no migrations): Bills page with add/edit forms (name, decimal amount, weekly/monthly/quarterly/yearly frequency, next due date, optional expense category), sections for "Needs attention" (overdue + due today), "Upcoming", and "Inactive" bills, edit, deactivate-with-confirmation (no deletes; history preserved), and per-bill payment history dialog (due date, paid date, amount, description from the linked expense). Mark-as-paid requires confirmation and calls ONLY the existing mark_bill_occurrence_paid RPC (signature verified against the live function) with optional amount-override and description; the frontend never inserts into bill_payments or pre-creates the expense — the RPC creates/links the expense, records the payment, and advances next_due_date (with last-day clamping via advance_due_date) atomically. Duplicate payment attempts map to a clear message ("already paid") and the list refreshes; the RPC's FOR UPDATE lock and unique (recurring_bill_id, due_date) index provide the server-side guarantee. Dashboard shows the next 14 days of active bill reminders with overdue/due-today emphasis. Deactivated bills generate no reminders. All amounts are decimal strings end to end.
Verification: `npm run typecheck` and `npm run build` pass. STRUCTURAL checks only, performed live: RPC signature and body inspected (ownership check, active check, occurrence-order check, prior-payment check, expense-category validation, atomic insert/update); unique one-payment-per-occurrence index confirmed; recurring_bills frequency CHECK allows exactly the four supported values; category FK enforces ownership and the assert-category-expense trigger blocks income categories. NOT yet exercised at runtime: actual mark-paid call (expense creation, due-date advancement, clamping), duplicate-payment rejection against a real session, edit flows, and cross-user RLS isolation — these need a signed-in browser session or scripted auth client; do not treat as complete until then.

## Phase 4 — AI assistant
- [x] Create authenticated Supabase Edge Function. (2026-11-22: `ai-assistant` deployed, `verify_jwt = true`; JWT also verified in-function via `auth.getUser()`; all data reads run under the caller's token so RLS scopes them; service-role key never used for user data.)
- [x] Store OpenAI API key as a Supabase Edge Function secret. (2026-11-22: `OPENAI_API_KEY` and `OPENAI_BASE_URL` are configured in the project's Edge Function secret store; the provider is an OpenAI-compatible Vocareum gateway (`https://openai.vocareum.com/v1`) whose keys start with `voc…`, so the function reads an optional `OPENAI_BASE_URL` and defaults to `api.openai.com/v1` when unset. Provider errors log status plus the sanitized provider message.)
- [x] Retrieve only minimal, authenticated user-scoped summaries. (Aggregates only: month totals, top categories with shares, budget progress, active bills, schedule, cash position. No raw transaction descriptions are sent.)
- [x] Implement spending insights. (Assistant page "Spending insights" quick task + free-form chat; grounded in application-computed aggregates.)
- [x] Implement budget and savings recommendations. ("Budget & savings ideas" quick task + chat; budget progress is application-calculated; prompt forbids guaranteed-savings claims.)
- [ ] Implement explanations of deterministic cash-flow forecasts. (Prompt/context layer implemented in the function, but wiring the verified Phase 3 forecast output in is DISABLED until the Phase 3 forecast runtime verification passes, per the phase requirement.)
- [x] Implement conversational budgeting Q&A. (Assistant page chat with suggested prompts; generic errors, retry state.)
- [x] Add rate limits, usage controls, and safe error handling. (10 req/min per user, 2000-char message cap, 6-turn history cap, 700-token completion cap, 45s upstream timeout, generic error messages with server-side console detail.)
- [x] Keep AI read-only; no autonomous record changes. (Structurally: SELECT-only queries in the function; no write path exists. The system prompt also instructs the model to refuse change requests and direct users to the app pages.)
- [ ] Test prompt injection in transaction notes and malformed requests. (Defenses implemented — sanitization, fence-marking, instruction-treatment rules; adversarial runtime tests still PENDING and listed in the Phase 4 status note.)

### Phase 4 status (2026-11-22): AI assistant implemented, pending key + runtime tests
Implemented: authenticated `ai-assistant` Edge Function (deployed, ACTIVE, JWT verified) with user-scoped aggregate context, strict read-only system prompt, prompt-injection defenses, per-user rate limiting, token/size caps, and safe generic errors; `Assistant` page with chat, suggested prompts, quick-task cards (insights, recommendations), typing indicator, error+retry states, "AI-generated" labelling, and mobile-responsive styles wired into nav as "AI Assistant". Money handling: aggregates are computed with integer-cent arithmetic on the server from `numeric(14,2)` values; no floats are introduced.
Secret configuration (2026-11-22): `OPENAI_API_KEY` and `OPENAI_BASE_URL` are set in the Edge Function secret store. The provider is an OpenAI-compatible Vocareum gateway (`https://openai.vocareum.com/v1`); its keys start with `voc…`, so the earlier 401 from api.openai.com was a provider mismatch, not a code fault. The function now reads an optional `OPENAI_BASE_URL` (default `https://api.openai.com/v1`) and logs a warning (not an error) for non-`sk-` keys when a custom base URL is present. Provider failures log the status plus the sanitized provider error message (key-redacted, 200 chars max); the key is never logged or returned.
Verification (structural, done): frontend build contains no "openai", "OPENAI_API_KEY", "sk-proj", or service-role strings (scanned the emitted bundle). Unauthenticated and anon-key calls to the deployed function return 401 (probed live: no token → 401; anon key as token → 401 "Sign in to use the assistant."). Function is listed ACTIVE with `verifyJWT: true`.
Verification (runtime, PENDING — needs a signed-in browser session): real chat round-trip against the Vocareum gateway with actual data; 429 rate-limit behavior; prompt-injection attempts inside transaction descriptions/category names; user A vs user B isolation with real sessions; malformed-payload probes (oversized message, bad JSON, wrong roles). No AI response ever mutates records (structural), but end-to-end confirmation requires the runtime pass above.
Known limitations: rate-limit buckets are in-memory (per-instance; reset on redeploy — documented, acceptable for MVP); forecast explanations intentionally disabled until Phase 3 runtime verification completes; Vocareum access depends on the user's remaining learning credits.

## MVP audit vs spec.md (2026-11-22)
Scope check of implemented features against spec.md sections 5.1–5.9 and the acceptance criteria. This audit records gaps only; it does not change scope.

### Functional gaps
1. Settings is missing salary-schedule and cash-position editing (spec 5.9). Users must currently fix a wrong payday, salary amount, or cash balance via the Forecast page (cash) or not at all in the UI (schedule fields can only be replaced by inserting a new active schedule via onboarding, which is unreachable after signup). HIGH-VALUE GAP.
2. Account/data deletion is not documented or exposed (spec 5.9 requires "a documented account/data deletion process"). NOTHING exists — no UI, no doc, no server process. Also required by acceptance criteria indirectly via data management.
3. Password reset flow is partial: login offers "Forgot password?" and sends the reset email, but there is no route/page that consumes the recovery link to set a new password (the link redirects to /login with the session in the fragment, which the app detects but then only signs the user in without prompting for a new password). Recovery-email deliverability itself is UNVERIFIED (Supabase SMTP in this dev project hit its rate limit during testing).
4. Onboarding does not cover recurring bills or an initial budget (spec 5.1 says "guide users through entering income schedule, starting balance, recurring bills, and an initial budget"). Onboarding is 3 steps: profile → salary → cash; no follow-up nudge to add bills/budgets.
5. Bill reminder preferences (spec 5.9) are not configurable — reminders are always on and fixed at a 14-day dashboard horizon. Arguably acceptable for MVP ("in-app presentation only"), but the spec names it under Settings.
6. Dashboard does not surface AI insights inline (spec 5.8 "AI insights when available"). The assistant exists on its own page; a dashboard card linking to it would satisfy the "when available" clause. LOW PRIORITY.

### Testing gaps (all runtime, pending a signed-in browser session)
- Transaction/budget/bill CRUD round-trips; mark-bill-paid end-to-end (expense creation, due-date advancement, clamping), duplicate-payment rejection.
- Cross-user RLS isolation probes against every user-owned table (Phase 2 line item, still open).
- Forecast end-to-end with real data: paid-bill exclusion, salary reconciliation against real transactions, cash-position update path, and the full reconciliation test contract in docs/salary-reconciliation.md (explicitly kept as its own testing item).
- Auth flows: real signup → onboarding → login round-trip, password recovery receiving and completing the reset, ADR-011 currency-change two-session race, and the bill-payment currency-lock path.
- AI assistant: live chat round-trip through the Vocareum gateway, rate-limit behavior, prompt-injection attempts, cross-user isolation, malformed payloads.
- Signup initialization trigger runtime verification (Phase 2 item, still open).

### Security gaps
- Phase 5 "no secrets in Git history" cannot be verified here: the workspace is not a git repository, so history scanning is deferred until the repo is connected/pushed.
- GitHub secret scanning / push protection: not enabled (no remote yet).
- GitHub Actions CI: not configured (no remote yet; also blocked on adding a test framework).
- No lint/test framework exists; adding one needs approval (new dependency).

### Deployment gaps
- Production Supabase project, production secrets (OPENAI_API_KEY/OPENAI_BASE_URL), Bolt Hosting env vars, production migration application, and public-URL verification are all Phase 6 items and not started.
- The dev-project Vocareum gateway must be re-evaluated for production: it is a learning-credits endpoint, so production needs a real OpenAI key (or an explicit decision to keep the gateway).

### Deliberately not done in this audit (per instructions)
- No feature rebuilds; no new MVP scope. The only code change made during this audit was replacing the stale Dashboard "Coming next" card (which wrongly claimed budgets/bills/forecast/AI were unreleased) with an accurate getting-started card that points to Transactions and the AI Assistant.

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
