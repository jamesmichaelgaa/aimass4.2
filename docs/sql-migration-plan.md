# SQL Migration and RLS Plan — aimass4.2

**Status:** Implemented. All schema was applied to the Supabase development project on 2026-11-22 through the Supabase migration tool and is recorded in the database's migration history. The exact applied SQL is preserved in `docs/sql/migrations/` per ADR-004. See the "Implemented status" section near the end of this document for the applied file list, deviations from this plan, and remaining work.

## 1. Objectives
- Create the approved eight-table MVP schema in dependency order.
- Enable RLS and least-privilege grants before the app stores real financial data.
- Enforce same-user relationships across categories, transactions, budgets, bills, and payments.
- Make bill payment atomic and duplicate-safe.
- Test forecast date boundaries and financial calculations before frontend integration.

## 2. Proposed migration sequence

Use timestamped Supabase CLI migration files. Suggested logical boundaries:

| Order | Suggested migration | Contents |
|---|---|---|
| 1 | `*_extensions_and_helpers.sql` | Required extensions only; shared timestamp helper if needed. |
| 2 | `*_profiles_and_categories.sql` | Profiles, user-owned categories, signup initialization, default category seed logic. |
| 3 | `*_financial_core.sql` | Cash positions, income schedules, transactions, budgets, recurring bills. |
| 4 | `*_bill_payments.sql` | Bill payments, integrity constraints, atomic payment RPC. |
| 5 | `*_indexes_and_rls.sql` | Supporting indexes, RLS enablement/policies, grants and revokes. |
| 6 | `*_verification.sql` | Schema assertions and safe development seed data, if required. |

The exact file boundaries can change during implementation. Dependencies must not. Do not put secrets or production user data in migrations.

## 3. Dependency order
1. Supabase Auth provides `auth.users` and verified identity.
2. `profiles` references `auth.users`.
3. `categories` references `auth.users`; default categories are created through trusted, idempotent signup initialization.
4. `cash_positions` and `income_schedules` reference `auth.users`.
5. `transactions`, `budgets`, and `recurring_bills` reference the owning user and, where applicable, that user's category.
6. `bill_payments` references the owner, recurring bill, and linked transaction.

Use composite unique keys and foreign keys where practical to enforce same-owner relationships. Use database triggers or trusted functions for rules that also depend on category/transaction kind. Frontend checks are not an integrity boundary.

## 4. RLS access matrix

Enable RLS on all eight tables. The intended authenticated-user policy model:

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| profiles | Own row only (`id = auth.uid()`) | Trusted signup initialization only | Own row only; protect identity and currency rule | No direct delete; use account/data deletion flow |
| cash_positions | Own rows | Own row | Own row | Own row |
| income_schedules | Own rows | Own rows | Own rows | Own rows |
| categories | Own rows | Own rows | Own rows, except protected defaults | Own non-system rows only |
| transactions | Own rows | Own rows | Own rows, subject to linked-payment integrity | Own rows, subject to FK restrictions |
| budgets | Own rows | Own rows | Own rows | Own rows |
| recurring_bills | Own rows | Own rows | Own rows | Only where no payment history; otherwise deactivate |
| bill_payments | Own rows | No direct client insert | No direct client update | No direct client delete |

For tables with `user_id`, use owner predicates equivalent to `user_id = (select auth.uid())`. For profiles, use `id = (select auth.uid())`. Never accept a browser-supplied owner ID as authority.

RLS does not grant SQL privileges. Review grants and policies together. Authenticated clients must not have direct write privileges for `bill_payments`; the dedicated payment RPC is the only supported write path.

## 5. Cross-table integrity

### Categories
- Every category has a non-null owner; default categories are user-owned, not globally shared.
- A transaction category must belong to the same user and match the transaction kind.
- A budget category must belong to the same user and be an expense category.
- A recurring bill category must belong to the same user and be an expense category.
- Use composite foreign keys where possible; use triggers for kind-specific validation where needed.
- Protect system/default categories from deletion or renaming if the product marks them as protected.

### Schedules and budgets
- Partial unique index: at most one active income schedule per user.
- Partial unique index for one overall budget per user/month.
- Partial unique index for one category budget per user/category/month.
- Budget month must be the first day of its calendar month.

### Bill payments
- Payment, bill, and linked transaction must belong to the same user.
- Linked transaction must be an expense.
- Unique occurrence key: `(recurring_bill_id, due_date)`.
- Unique transaction link: one transaction can be linked to at most one bill payment.
- Use `ON DELETE RESTRICT` where deletion would destroy payment history.
- Deactivate bills with payment history rather than deleting them.

## 6. Atomic bill-payment RPC

Expose one narrowly scoped Postgres function for marking a bill occurrence paid. It must:

1. Derive the caller from `auth.uid()`; do not accept an arbitrary user ID.
2. Reject unauthenticated calls.
3. Lock the recurring bill row with `SELECT ... FOR UPDATE` to serialize concurrent attempts.
4. Verify ownership, active state, expected occurrence date, and expense category.
5. Reject an already-paid occurrence; the unique occurrence constraint remains the final race-condition safeguard.
6. Create an expense transaction or validate a supplied transaction belongs to the caller and is an expense.
7. Insert the bill payment.
8. Advance `next_due_date` using the documented recurrence rule.
9. Return the payment and transaction identifiers.
10. Run as one database transaction so any failure rolls back every write.

Prefer a carefully reviewed `SECURITY DEFINER` function only if needed to permit this narrow operation while direct payment-table writes are revoked. If used: set a fixed safe `search_path`, schema-qualify referenced objects, derive identity from `auth.uid()`, validate every row's ownership, avoid dynamic SQL, and grant execute only to the intended role. Do not use the service-role key in the browser or as an authorization shortcut. Test concurrent duplicate requests and retry behavior.

## 7. Signup initialization
Use one trusted, idempotent initialization path to:
- Create the profile with PHP and Asia/Manila defaults.
- Create the user's default income and expense categories.
- Avoid duplicates when initialization is retried.

If using an Auth trigger, keep it small and test failure behavior carefully because a failing trigger can prevent signup. Never allow one user to initialize another user's records.

## 8. Index plan
Review at minimum:
- `income_schedules(user_id)` and the partial unique active-schedule index.
- `categories(user_id, kind)` and case-insensitive category-name uniqueness.
- `transactions(user_id, transaction_date)`; add kind to the index only if query patterns justify it.
- `budgets(user_id, month)` and category/month uniqueness.
- `recurring_bills(user_id, is_active, next_due_date)`.
- `bill_payments(user_id, due_date)`, unique bill occurrence, and unique transaction link.
- Index referencing foreign-key columns where needed.

Avoid speculative indexes until query patterns are known. A unique constraint/index already provides its own index.

## 9. Forecast test contract
Forecast logic is deterministic, not AI arithmetic. Tests must verify:
- Starting cash is the closing amount on `as_of_date`.
- Only recorded transactions dated after `as_of_date` are added.
- Forecast cutoff is the next expected payday, inclusive.
- Expected salary on that date is included and labelled expected.
- An actual salary transaction for the same payday is reconciled so income is not double-counted.
- Unpaid bill occurrences in the forecast window are included.
- Paid occurrences are represented by their linked expense transaction and are not subtracted twice.
- Monthly, quarterly, and yearly bill recurrence clamps unavailable day numbers to the destination month's last day.
- Biweekly salary recurrence advances exactly 14 days.
- Money arithmetic remains decimal-safe.

Choose and test a reliable salary reconciliation key/rule before implementation. Do not match unrelated income transactions only because their amounts happen to be equal.

## 10. Required verification before frontend integration
- RLS enabled on every user-owned table.
- User A cannot read or modify User B's records.
- Cross-user category references and wrong-kind categories are rejected.
- Duplicate active schedules and duplicate budgets are rejected.
- Duplicate bill occurrences are rejected, including concurrent requests.
- Bill payments cannot link income or another user's transactions.
- Direct client writes to bill_payments are denied.
- Failed payment operations leave no partial transaction/payment/date changes.
- Deletion of bill-linked transactions or bills with payment history is restricted.
- Signup initialization is idempotent.
- Forecast tests cover date boundaries, salary reconciliation, and bill double-counting.
- No secrets are embedded in migrations.

## 11. Explicitly out of scope
This stage does not create a Supabase project, write/apply executable SQL, add frontend code, configure OpenAI secrets, connect Bolt, or deploy the app. Those actions come after the implementation plan is reviewed and approved.

---

## Implemented status (2026-11-22)

All schema was applied to the Supabase development project through the Supabase migration tool. The Supabase CLI is unsupported in this environment and files written to `supabase/migrations/` are not executed, so ADR-004 is preserved by archiving the exact applied SQL under `docs/sql/migrations/`. The database's migration history is the executable source of truth.

### Applied migration files, in application order

1. `20261122102842_20261122000001_extensions_and_helpers.sql.sql` — shared `set_updated_at()` trigger helper.
2. `20261122102850_20261122000002_profiles_and_categories.sql.sql` — first version of the profiles/categories migration; superseded (kept in history).
3. `20261122102910_20261122000002_profiles_and_categories.sql.sql` — corrected version; adds the `(user_id, id, kind)` unique index required by the transactions composite foreign key. Creates profiles, user-owned categories, signup trigger, default category seed, currency-immutable trigger.
4. `20261122102921_20261122000003_financial_core.sql.sql` — cash positions, income schedules, transactions, budgets, recurring bills; partial unique indexes; composite foreign keys; expense-kind validation triggers.
5. `20261122102933_20261122000004_bill_payments.sql.sql` — bill_payments table with occurrence/transaction uniqueness, RESTRICT references, `advance_due_date` recurrence helper, and the `mark_bill_occurrence_paid` SECURITY DEFINER RPC.
6. `20261122102945_20261122000005_indexes_and_rls.sql.sql` — query and foreign-key indexes; full RLS policy set and grants; protected system categories; no-delete for bills with payment history; read-only bill_payments; no client INSERT/DELETE on profiles.
7. `20261122103014_20261122000006_verification.sql.sql` — structural assertions confirming tables, RLS, policies, unique safeguards, triggers, RPC grants, and write denial on bill_payments.
8. `20261122103040_20261122000001_extensions_and_helpers.sql.sql` — re-apply of migration 1 pinning `search_path` on `set_updated_at()`.
9. `20261122103049_20261122000007_function_search_path_hardening.sql.sql` — pins `search_path` on remaining helper functions; fixes `advance_due_date` day clamping for short months.

### Why nine files implement six planned logical migrations

The plan defined six logical boundaries. During application, two migrations failed their first apply and were corrected and re-applied under the same logical change, and one additional hardening migration was added from the security advisor's findings:

- Profiles/categories (planned file 2) failed first apply because the transactions composite foreign key needs a `(user_id, id, kind)` unique index on categories. The corrected version was applied under the same logical change; both versions remain in the migration history.
- Extensions/helpers (planned file 1) was re-applied once to pin `set_updated_at()`'s `search_path` after the security advisor flagged mutable search paths.
- File 9 in the list above (`function_search_path_hardening`) is an unplanned addition, closing the advisor's search-path findings on the remaining helper functions and fixing the day-clamping bug in `advance_due_date` for months shorter than 31 days.

### Deviations from this plan

- Migration delivery: applied through the Supabase migration tool rather than CLI-written files; approved as a conscious deviation from ADR-004's executable-file interpretation, with GitHub archiving the exact applied SQL.
- Owner columns default to `auth.uid()` so client inserts that omit the owner still satisfy RLS.
- Currency rule as implemented: `profiles_enforce_currency_immutable` blocks ALL preferred-currency changes. Corrected product rule (approved 2026-11-22): allow currency changes before any financial records exist; block them once financial records exist. A follow-up migration to implement the corrected rule is pending; it must not be bundled with unrelated changes.
- Service-role grants for the AI Edge Function are deferred to Phase 4 (least privilege).
- Recurrence advancement is implemented in the database only for the bill-payment path (`advance_due_date`); salary progression and forecast arithmetic remain application logic per ADR-005 and the forecast contract.

### Pending work before frontend integration

- Apply the currency-rule correction migration (allow changes before financial records exist, block after).
- Runtime tests: signup initialization idempotency, atomic bill payment (including concurrent duplicates and rollback), cross-user RLS isolation, and direct-write denial on bill_payments.
- Define and test the forecast salary reconciliation rule (section 9) before building the forecast feature.
- GitHub Actions CI remains unconfigured until package scripts exist (Phase 1).
