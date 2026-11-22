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
- [ ] Enable GitHub secret scanning and push protection where available.
- [ ] Connect repository to Bolt without overwriting documentation.

## Phase 1 — Frontend foundation
- [ ] Scaffold React + TypeScript + Vite application.
- [ ] Establish routing, layout, responsive navigation, and design system.
- [ ] Build onboarding and authentication screens.
- [ ] Build dashboard shell with loading, empty, and error states.
- [ ] Add lint, typecheck, test, and production build scripts.
- [ ] Add GitHub Actions CI using actual package scripts.

## Phase 2 — Supabase foundation
- [ ] Review and approve SQL migration and RLS implementation details.
- [ ] Create a new Supabase development project.
- [ ] Configure Auth providers and redirect URLs.
- [ ] Create and commit SQL migrations.
- [ ] Enable RLS on every user-owned table.
- [ ] Add owner-scoped policies and validate foreign-key ownership.
- [ ] Add indexes, constraints, and safe monetary data types.
- [ ] Implement and test signup initialization.
- [ ] Implement and test atomic bill-payment RPC.
- [ ] Test cross-user access isolation and direct-write denial.

## Phase 3 — Core budgeting features
- [ ] Profile, preferred currency, timezone, and cash position/as-of date.
- [ ] Onboarding for monthly/biweekly salary and next payday.
- [ ] Manual income and expense tracking.
- [ ] Default and custom categories.
- [ ] Overall and category monthly budgets.
- [ ] Dashboard income, expenses, cash position, and budget progress.
- [ ] Recurring bill setup and recurrence rules.
- [ ] In-app upcoming and overdue bill reminders.
- [ ] Mark bill occurrence paid and prevent duplicate expense counting.
- [ ] Deterministic payday/cash-flow forecast with visible assumptions.
- [ ] Settings and account/data management.

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
