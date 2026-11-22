# Architecture Decision Records

## ADR-001: Supabase for backend and database
**Status:** Proposed

Use Supabase PostgreSQL, Auth, RLS, and Edge Functions to reduce backend operational overhead while retaining SQL migrations and explicit data ownership policies.

## ADR-002: Server-side OpenAI integration
**Status:** Accepted

The OpenAI API key must be stored as a Supabase Edge Function secret. The browser must never call OpenAI using a private key.

## ADR-003: Read-only AI assistant for MVP
**Status:** Accepted

The AI assistant can summarize and suggest but cannot create, edit, or delete financial records. This limits the impact of incorrect or manipulated model output.

## ADR-004: GitHub as source of truth
**Status:** Accepted

Project source, documentation, migrations, tests, and CI configuration are version-controlled in this repository. Bolt and Codex changes must be reflected in GitHub.
