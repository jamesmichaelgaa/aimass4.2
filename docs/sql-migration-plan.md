# SQL Migration and RLS Plan — aimass4.2

**Status:** Implementation blueprint only. No Supabase project has been created and no SQL migration has been executed. Translate this plan into reviewed, versioned migrations only after the plan is approved.

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
