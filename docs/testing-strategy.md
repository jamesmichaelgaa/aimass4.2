# Testing Strategy — aimass4.2

## 1. Goals
Verify that core budgeting workflows are correct, user data is isolated, forecasts are explainable, AI stays within read-only boundaries, and the deployed application works on supported screen sizes.

## 2. Test layers

### Unit tests
Test pure business logic without network or database dependencies:
- Currency formatting and monetary arithmetic.
- Monthly and biweekly payday date progression.
- Monthly payday fallback to the last day of shorter months.
- Budget spent/remaining/percentage calculations.
- Recurring bill next-due-date calculations.
- Upcoming/overdue bill classification.
- Bill payment duplicate prevention rules.
- Forecast arithmetic and date-window boundaries.
- Validation of amounts, dates, and required fields.

Use decimal-safe representations for monetary calculations. Avoid floating-point rounding errors.

### Component tests
Test:
- Transaction form validation and submission states.
- Budget creation/editing and progress display.
- Recurring bill forms and mark-as-paid confirmation.
- Onboarding salary and cash-position inputs.
- Dashboard loading, empty, error, and populated states.
- AI chat rendering, safe formatting, and error/rate-limit states.
- Responsive navigation and accessible labels.

### Integration tests
Test application behavior against a dedicated development/test Supabase project:
- Authenticated profile setup.
- Transaction CRUD and category ownership.
- Overall/category budget CRUD.
- Recurring bill creation and due-date behavior.
- Atomic bill payment with linked expense.
- Forecast query inputs and returned calculations.
- Authenticated Edge Function request and safe provider error handling.

Never run destructive integration tests against production data.

### Row Level Security tests
Create at least two test users (User A and User B). Verify:
- A can read and mutate only A's profile/cash position/salary schedule.
- A can read and mutate only A's transactions, categories, budgets, bills, and payment records.
- B cannot read, update, or delete A's records by guessing UUIDs.
- Inserts with another user's user_id are rejected or ignored safely.
- Cross-user foreign-key references are rejected.
- Global system categories are readable as intended but cannot be modified by normal users.
- Unauthenticated requests cannot access private records.

### End-to-end tests
Critical journeys:
1. Sign up/sign in and complete onboarding.
2. Configure monthly salary, cash position, and next payday.
3. Configure biweekly salary and verify next-payday progression.
4. Add income and expense; verify dashboard totals.
5. Create overall/category budget; verify spending progress.
6. Add recurring bill; verify upcoming/overdue in-app status.
7. Mark a bill occurrence paid; verify exactly one linked expense and no duplicate counting.
8. Update cash position and verify forecast changes.
9. Ask AI for spending insights and forecast explanation.
10. Confirm AI cannot mutate any financial records.
11. Sign out and verify protected routes require authentication.

## 3. AI-specific tests
- Valid authenticated spending-insight request.
- Valid budget/savings recommendation request.
- Forecast explanation uses supplied values without changing them.
- Conversational question with sufficient data.
- Question with missing or ambiguous data.
- Prompt injection placed in transaction description, bill name, or user question.
- Requests attempting to access another user.
- Requests asking the model to execute SQL, code, or financial transactions.
- Oversized payload, invalid task type, rate limiting, and provider timeout.
- Output containing unsafe HTML or executable content is safely rendered as text.
- Assert no database mutations occur as a result of AI requests.

Use deterministic mocked model responses for most automated tests. Run a small controlled integration suite against the provider only when credentials are configured securely.

## 4. Security tests
- Verify no secrets in tracked files, commit diffs, frontend bundles, source maps, or logs.
- Verify OpenAI key is only configured as a server-side secret.
- Verify Supabase service-role key is never shipped to the browser.
- Verify RLS is enabled for every user-owned table.
- Verify authorization on every Edge Function request.
- Verify rate limits and input size limits.
- Verify no raw SQL or model-generated tool execution.
- Review dependencies and lockfile changes.

If a secret is accidentally committed or exposed, rotate it immediately. Removing it from the latest file is not sufficient.

## 5. Accessibility and responsive testing
- Keyboard navigation and visible focus.
- Form labels, validation messages, and semantic headings.
- Sufficient color contrast and readable status indicators.
- Screen-reader-friendly charts/summaries.
- Test narrow mobile, tablet, and desktop viewports.
- Ensure critical actions are usable without hover.

## 6. CI quality gates
Once the app scaffold and scripts exist, GitHub Actions should run:
1. Dependency install using the committed lockfile.
2. Formatting/lint checks.
3. TypeScript typecheck.
4. Unit/component tests.
5. Production build.
6. Additional integration/security jobs when test services and secrets are configured.

CI must not require production secrets for ordinary pull-request checks. Use mocks or isolated test credentials.

## 7. Release acceptance
Do not release until:
- Critical E2E flows pass.
- RLS isolation tests pass.
- Forecast and monetary calculations pass.
- AI read-only and prompt-injection tests pass.
- No known secret exposure remains.
- Production build succeeds.
- Manual smoke test confirms authentication, transactions, budgets, bills, forecast, and AI.
- Backup/recovery and rollback approach is documented.
