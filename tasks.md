# Development Tasks — aimass4.2

## Phase 0 — Foundation
- [x] Create private GitHub repository.
- [x] Define initial product specification.
- [x] Define agent instructions and security requirements.
- [x] Document proposed architecture and database model.
- [ ] Review scope and confirm MVP decisions.
- [ ] Enable GitHub secret scanning and push protection if available.
- [ ] Create initial Bolt project and connect this repository.

## Phase 1 — Frontend foundation
- [ ] Scaffold React + TypeScript application.
- [ ] Establish routing, layout, design tokens, and responsive navigation.
- [ ] Add accessible form and feedback components.
- [ ] Add lint, typecheck, test, and build scripts.
- [ ] Create CI workflow after scripts are known.

## Phase 2 — Supabase foundation
- [ ] Create development Supabase project.
- [ ] Configure Auth and allowed redirect URLs.
- [ ] Create migrations for profiles, categories, transactions, budgets, savings goals, and contributions.
- [ ] Enable RLS and add owner-scoped policies.
- [ ] Add indexes, constraints, and category/goal ownership validation.
- [ ] Test that one user cannot read or modify another user's records.

## Phase 3 — MVP application features
- [ ] Authentication and profile settings.
- [ ] Category management.
- [ ] Income and expense CRUD.
- [ ] Dashboard summaries and filters.
- [ ] Monthly budgets and progress.
- [ ] Savings goals and contributions.
- [ ] Loading, empty, validation, and error states.

## Phase 4 — AI assistant
- [ ] Create authenticated Supabase Edge Function.
- [ ] Store OpenAI API key as a Supabase secret.
- [ ] Implement minimal user-scoped context retrieval.
- [ ] Add prompt-injection handling and output constraints.
- [ ] Add rate limits and usage controls.
- [ ] Keep MVP AI assistant read-only.
- [ ] Test missing data, malicious notes, malformed input, and upstream failures.

## Phase 5 — Quality and security
- [ ] Unit and component tests.
- [ ] Database/RLS integration tests.
- [ ] End-to-end critical-path tests.
- [ ] Secret scanning and dependency review.
- [ ] Accessibility and responsive checks.
- [ ] Production build and smoke tests.

## Phase 6 — Launch
- [ ] Configure production Supabase project and secrets.
- [ ] Configure Bolt Hosting environment variables.
- [ ] Apply production migrations.
- [ ] Deploy and verify public URL.
- [ ] Verify sign-in, transaction CRUD, RLS, and AI endpoint.
- [ ] Document setup, backup, recovery, and release procedures.
