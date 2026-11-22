# Architecture Notes — aimass4.2

## 1. Architectural overview
The system uses a web client, Supabase as the managed backend, and a server-side AI integration.

```text
User
  |
  v
React + TypeScript web client (Bolt)
  |                        |
  | authenticated          | AI request (no provider key)
  v                        v
Supabase Auth         Supabase Edge Function
  |                        |
  v                        v
PostgreSQL + RLS        OpenAI API
  |
  v
User-scoped financial data

GitHub: source control, documentation, migrations, tests, CI
Codex: repository-aware implementation, review, and testing
```

## 2. Components
### Web client
- React + TypeScript.
- Responsible for presentation, navigation, form validation for usability, and calling Supabase with the user's session.
- Client validation is not a security boundary; enforce authorization and validation on the server/database.
- No OpenAI secret or Supabase service-role credential in browser code.

### Supabase
- Auth provides user identity and sessions.
- PostgreSQL stores profiles, categories, accounts (if enabled), transactions, budgets, savings goals, and contributions.
- RLS policies isolate user-owned records using the authenticated identity.
- Edge Functions validate bearer tokens and request payloads before performing privileged operations or calling external APIs.
- Database migrations are committed under `supabase/migrations/`.

### OpenAI integration
- Invoked only from a server-side Edge Function.
- The function obtains the user's identity from a verified Supabase JWT, retrieves only relevant scoped records, minimizes/redacts context, enforces request limits, and calls the model using a secret stored in Supabase.
- Model output is treated as untrusted text. Render safely; do not execute model-generated code or SQL.
- MVP AI assistant is read-only.

### GitHub and Codex
- GitHub is the canonical source of truth.
- Changes should be committed in small, reviewable units.
- Codex should follow `AGENTS.md`, inspect the codebase, add tests, and report verification.
- CI should run lint, typecheck, tests, and build after the scaffold defines the appropriate scripts.

## 3. Data flow
1. User signs in through Supabase Auth.
2. Client obtains a Supabase session.
3. Client reads/writes permitted user-owned rows; PostgreSQL RLS enforces ownership.
4. For AI, client calls the Edge Function with the current access token and a narrowly scoped question/context request.
5. Edge Function validates the token and input, determines user ID from the verified identity, retrieves only necessary user-owned summaries, and calls OpenAI.
6. Function returns a constrained response. It does not write financial records in the MVP.

## 4. Key design decisions
- PostgreSQL `numeric` for money values; avoid floating-point persistence.
- Use ISO date values for transaction dates and a clearly defined timezone for display.
- Use RLS as defense in depth, not client-side filters alone.
- Prefer aggregate queries for dashboard summaries rather than downloading all transactions.
- Keep AI requests server-side and read-only.
- Use migrations for repeatable schema changes.

## 5. Operational concerns
- Separate development and production Supabase projects when practical.
- Store environment-specific secrets in platform secret managers.
- Apply database migrations deliberately and back up production data before risky schema changes.
- Add rate limiting and usage controls to AI endpoints.
- Monitor errors without logging secrets or unnecessary financial details.
- Configure CI after the actual frontend package scripts and tests exist.

## 6. Deployment
The initial target is Bolt Hosting for the web client. Supabase remains the managed backend. Production deployment requires configured environment variables, Supabase URL/auth settings, RLS policies, Edge Function secrets, and a smoke test against the published URL.
