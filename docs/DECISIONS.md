# Product and Architecture Decisions — aimass4.2

## ADR-001: Supabase for backend and database
**Status:** Accepted  
Use Supabase PostgreSQL, Auth, RLS, and Edge Functions to reduce backend operational overhead while retaining SQL migrations and explicit data ownership policies.

## ADR-002: Server-side OpenAI integration
**Status:** Accepted  
The OpenAI API key must be stored as a Supabase Edge Function secret. The browser must never call OpenAI using a private key.

## ADR-003: Read-only AI assistant for MVP
**Status:** Accepted  
The AI assistant may provide insights, recommendations, forecast explanations, and conversational answers. It cannot create, edit, delete, pay, or schedule financial records.

## ADR-004: GitHub as source of truth
**Status:** Accepted  
Project source, documentation, migrations, tests, and CI configuration are version-controlled in this repository. Bolt and Codex changes must be reflected in GitHub.

## ADR-005: Salary schedules
**Status:** Accepted  
MVP supports monthly and biweekly pay schedules only. Biweekly means every 14 days. Monthly schedules use calendar-month progression; if a target day does not exist in a month, use that month's last calendar day. No weekend/holiday adjustment in MVP.

## ADR-006: Bill reminders
**Status:** Accepted  
MVP reminders are in-app only, derived from active recurring bills and their due dates. Email and push notifications are deferred.

## ADR-007: AI capabilities
**Status:** Accepted  
MVP AI scope is limited to spending insights, budget/savings recommendations, cash-flow forecast explanations, and conversational budgeting Q&A. Automatic expense categorization and autonomous actions are excluded.

## ADR-008: Subscription pricing
**Status:** Deferred  
Do not implement subscriptions, payment processing, premium feature gates, or the proposed ₱149/month price in MVP. Validate product usage first.

## ADR-009: PDF reports
**Status:** Deferred  
PDF report generation/export is post-MVP.

## ADR-010: Cash position and forecast
**Status:** Accepted for MVP  
User manually enters a cash position and the date it is accurate as of. The app estimates cash through the next payday using subsequent recorded transactions, expected salary, and unpaid bill occurrences. Forecasts must disclose assumptions and are not guaranteed balances.

## ADR-011: Preferred currency change policy
**Status:** Accepted and implemented (2026-11-22)
Users may change their preferred currency only while they have no financial records (no transactions, bill payments, or budgets). Once any financial record exists, currency changes are blocked so historical amounts are never silently relabelled; a change would then require an explicit data migration. Implementation: conditional trigger with concurrency protection (record inserts lock the user's profile row in FOR SHARE mode, conflicting with the currency change's row lock), applied via migration `20261122110000_adr011_conditional_currency_rule.sql`. Verified behavior: allowed with zero records, blocked with a transaction or budget present, restored after deletion, other profile fields unaffected. Pending verification: two-session race test and the bill-payment path (Phase 2 runtime tests).
