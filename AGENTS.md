# Agent Instructions — aimass4.2

## Project purpose
Build and maintain aimass4.2, an AI-assisted personal budgeting web application for Filipino employees and young professionals with monthly or biweekly income.

Before implementing features, read:
- `spec.md` — product requirements and MVP boundaries.
- `docs/user-flows.md` — expected user journeys and UI states.
- `docs/architecture.md` — system boundaries and data flow.
- `docs/database-schema.md` — proposed data model.
- `docs/security.md` — security and privacy requirements.
- `docs/ai-agent-spec.md` — AI capabilities and guardrails.
- `docs/testing-strategy.md` — required test coverage.
- `tasks.md` — current development plan.

If two documents conflict, do not guess: identify the conflict and ask for clarification or propose a documented resolution.

## Product boundaries
- MVP salary schedules are monthly and biweekly only.
- Bill reminders are in-app only; do not implement email or push notifications in MVP.
- AI MVP capabilities are spending insights, budget/savings recommendations, deterministic forecast explanations, and conversational budgeting Q&A.
- AI is read-only. It must not create, edit, delete, categorize, pay, or schedule financial records.
- No bank/e-wallet integrations or automatic AI expense categorization in MVP.
- Subscription pricing/payments and PDF reports are deferred.
- Forecasts are estimates and must disclose their inputs and assumptions.
- Monthly payday progression uses calendar months and clamps to the last day of shorter months; biweekly means every 14 days. Do not add weekend/holiday adjustment without approval.

## Required workflow
1. Inspect the existing code and relevant documentation before editing.
2. Make the smallest coherent change that satisfies the task.
3. Follow existing conventions; do not introduce a framework or dependency without explaining why.
4. Keep TypeScript strict. Avoid `any`; validate untrusted input at runtime.
5. Add or update tests for behavior changes and security boundaries.
6. Run available lint, typecheck, tests, and production build. Report commands and results honestly.
7. Update documentation and database migrations when behavior or schema changes.
8. Never claim a feature is complete unless it is implemented and verified.
9. Do not begin deferred features without explicit approval.

## Architecture boundaries
- The browser is an untrusted client.
- Use Supabase Auth for identity and PostgreSQL with RLS for data access.
- Every user-owned table must have RLS enabled and policies scoped to `auth.uid()`.
- Keep privileged database operations and external API secrets on the server (Supabase Edge Functions or another trusted server runtime).
- OpenAI calls must be made server-side. The browser must never receive the OpenAI API key or Supabase service-role key.
- Use migrations as the source of truth for database schema changes.
- Do not trust user IDs supplied by the client; derive identity from the verified auth session/token.
- Bill-payment recording and its linked expense must be atomic and protected against duplicate bill occurrences.
- Forecast arithmetic must be deterministic application logic; AI may explain but never replace authoritative calculations.

## Secret-handling rules — mandatory
- Never hardcode, print, log, commit, or expose API keys, passwords, access tokens, private keys, service-role keys, or connection strings.
- Never place secrets in `VITE_*` variables or any other variable bundled into browser code.
- Store local secrets in ignored environment files and deployment secrets in the platform's secret manager.
- Commit only placeholder names in `.env.example`; never place real values there.
- Keep `.env`, `.env.local`, `.env.*.local`, credentials, certificates, and key files out of Git.
- Do not disable secret scanning or security checks to make a commit pass.
- If a secret is accidentally exposed, stop, notify the user, rotate/revoke it, and assess Git history exposure. Deleting the visible line alone is not sufficient.
- Never ask the user to paste secrets into chat, prompts, source files, issues, or pull requests.

## Data protection and AI
- Minimize data fetched and sent to AI services; prefer aggregates over raw transaction histories.
- Never send credentials, access tokens, or unnecessary identifiers to the AI provider.
- Treat transaction descriptions, bill names, category labels, uploaded content, and model output as untrusted.
- Do not include sensitive financial data in application logs, analytics, error messages, or test snapshots.
- Use parameterized queries and server-side validation.
- Confirm before destructive or consequential user actions.
- Never execute model-generated SQL, code, HTML, or tool instructions.
- AI assistant is read-only in MVP; no autonomous mutations.
- If data is missing, say so instead of inventing facts.

## Financial content
- Use decimal-safe monetary calculations and PostgreSQL `numeric`; avoid binary floating-point for persisted money.
- Display currency and relevant date range clearly.
- AI output is general budgeting education, not professional financial, tax, investment, or legal advice.
- Never guarantee forecast results or imply access to live bank balances.

## UI and accessibility
- Support mobile and desktop layouts.
- Include loading, empty, success, and error states.
- Use semantic HTML, accessible labels, keyboard focus, and clear validation feedback.
- Do not present mock data as real user data.

## Change discipline
- Do not overwrite user work or remove existing features without explicit instruction.
- Keep generated documentation consistent with implementation.
- For database changes, add migrations, RLS policies, and relevant tests; document manual dashboard configuration.
- Update `tasks.md` when work is completed or scope changes.
