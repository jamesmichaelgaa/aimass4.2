# Development Tasks — aimass4.2

## Phase 0 — Product and repository foundation
- [x] Create private GitHub repository.
- [x] Draft product specification.
- [x] Draft agent instructions and security policy.
- [x] Draft architecture and database design.
- [ ] Review MVP scope and resolve open product questions.
- [ ] Enable GitHub secret scanning and push protection where available.
- [ ] Connect the repository to Bolt without overwriting documentation.

## Phase 1 — Frontend foundation
- [ ] Scaffold React + TypeScript + Vite application in Bolt.
- [ ] Establish routing, layout, responsive navigation, and design system.
- [ ] Build onboarding and authentication screens.
- [ ] Build dashboard shell with empty/loading/error states.
- [ ] Add lint, typecheck, test, and production build scripts.
- [ ] Add GitHub Actions CI using the actual package scripts.

## Phase 2 — Supabase foundation
- [ ] Create a new Supabase development project.
- [ ] Configure Auth providers and redirect URLs.
- [ ] Create and commit SQL migrations.
- [ ] Enable RLS on every user-owned table.
- [ ] Add owner-scoped policies and validate foreign-key ownership.
- [ ] Add indexes, constraints, and safe monetary data types.
- [ ] Test cross-user access isolation.

## Phase 3 — Core budgeting features
- [ ] User profile, preferred currency, and timezone.
- [ ] Onboarding: salary amount, pay frequency, next payday, optional starting balance.
- [ ] Manual income and expense tracking.
- [ ] Default and custom categories.
- [ ] Overall and category monthly budgets.
- [ ] Dashboard income, expenses, net cash flow, and budget progress.
- [ ] Recurring bill setup and recurrence rules.
- [ ] Upcoming and overdue bill views.
- [ ] Mark bill paid and prevent duplicate expense counting.
- [ ] Payday/cash-flow forecast with visible assumptions.
- [ ] Settings and account/data management.

## Phase 4 — AI assistant
- [ ] Define narrow AI use cases and data-minimization rules.
- [ ] Create authenticated Supabase Edge Function.
- [ ] Store OpenAI API key using Supabase Edge Function secrets.
- [ ] Retrieve only the authenticated user's relevant summaries.
- [ ] Implement spending summaries and budget insights.
- [ ] Implement budget/savings recommendations.
- [ ] Add payday-aware explanations based on upcoming bills and forecast data.
- [ ] Add rate limits, usage limits, and safe error handling.
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
- [ ] Confirm MVP scope, pricing decisions, and launch limits.
- [ ] Configure production Supabase project and secrets.
- [ ] Configure Bolt Hosting environment variables.
- [ ] Apply production migrations.
- [ ] Deploy and verify public URL.
- [ ] Verify authentication, transaction CRUD, budgets, bills, forecasts, and AI.
- [ ] Document release, backup, recovery, and support procedures.

## Post-MVP candidates
- [ ] PDF/export reports.
- [ ] Email or push bill reminders.
- [ ] Recurring income and recurring transactions automation.
- [ ] Premium subscription and payment integration.
- [ ] Bank/e-wallet integrations (only after a separate security and feasibility review).
