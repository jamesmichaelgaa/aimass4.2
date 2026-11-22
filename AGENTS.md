# Agent Instructions — aimass4.2

## Project purpose
Build and maintain aimass4.2, an AI-assisted personal budgeting web application. Read `spec.md`, `docs/architecture.md`, `docs/security.md`, and `docs/database-schema.md` before making architectural or data-model changes.

## Required workflow
1. Inspect the existing code and documentation before editing.
2. Make the smallest coherent change that satisfies the task.
3. Follow existing conventions; do not introduce a new framework or dependency without explaining why.
4. Keep TypeScript strict. Avoid `any`; validate untrusted input at runtime.
5. Add or update tests for behavior changes and security boundaries.
6. Run available lint, typecheck, tests, and production build. Report commands and results honestly.
7. Update documentation and database migrations when behavior or schema changes.
8. Never claim a feature is complete unless it is implemented and verified.

## Architecture boundaries
- The browser is an untrusted client.
- Use Supabase Auth for identity and PostgreSQL with RLS for data access.
- Every user-owned table must have RLS enabled and policies that scope reads/writes to `auth.uid()`.
- Keep privileged database operations and external API secrets on the server (Supabase Edge Functions or another trusted server runtime).
- OpenAI calls must be made server-side. The browser must never receive the OpenAI API key or Supabase service-role key.
- Use migrations as the source of truth for database schema changes.
- Do not trust user IDs supplied by the client; derive the identity from the verified auth session/token.

## Secret-handling rules — mandatory
- Never hardcode, print, log, commit, or expose API keys, passwords, access tokens, private keys, service-role keys, or connection strings.
- Never place secrets in `VITE_*` variables or any other variable bundled into browser code.
- Store local secrets in ignored environment files and deployment secrets in the platform's secret manager.
- Commit only placeholder names in `.env.example`; never place real values there.
- Keep `.env`, `.env.local`, `.env.*.local`, credentials, certificates, and key files out of Git.
- Do not disable secret scanning or security checks to make a commit pass.
- If a secret is accidentally exposed, stop, notify the user, rotate/revoke it, remove it from active use, and assess Git history exposure. Deleting the visible line alone is not sufficient.
- Never ask the user to paste secrets into chat, prompts, source files, issues, or pull requests.

## Data protection
- Minimize the data fetched and sent to AI services.
- Treat transaction descriptions, notes, uploaded content, and model output as untrusted.
- Do not include sensitive financial data in application logs, analytics, error messages, or test snapshots.
- Use parameterized queries and server-side validation.
- Confirm before destructive or consequential actions.
- AI assistant is read-only in MVP; do not build autonomous transaction, budget, or goal mutations.

## Financial content
- Show calculations transparently and use decimal-safe numeric handling for monetary values (PostgreSQL `numeric`; avoid binary floating-point arithmetic for persisted money).
- AI output is general budgeting education, not professional financial, tax, investment, or legal advice.
- Never invent financial facts when data is missing.

## UI and accessibility
- Support mobile and desktop layouts.
- Include loading, empty, success, and error states.
- Use semantic HTML, accessible labels, keyboard focus, and clear validation feedback.

## Change discipline
- Do not overwrite user work or remove existing features without explicit instruction.
- Do not introduce mock data as if it were live user data.
- Keep generated documentation consistent with the implementation.
- For database changes, add reversible/forward-safe migrations where practical and document any manual dashboard configuration.
