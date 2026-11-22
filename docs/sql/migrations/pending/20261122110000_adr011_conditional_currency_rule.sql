/*
# Conditional preferred-currency rule with concurrency protection (ADR-011)

Status: PREPARED, NOT APPLIED. Apply through the Supabase migration tool only
after approval.

1. Plain-English explanation
   - Corrects the currency rule: users may change their preferred currency only
     while they have no financial records. Once they have any transactions,
     bill payments, or budgets, currency changes are blocked so historical
     amounts are never silently relabelled.
   - Replaces the previous blanket block with a conditional, race-safe check.
   - All other profile updates (display name, timezone) are unaffected: if the
     currency value is unchanged, the trigger returns before doing any work.
   - Also widens the profile UPDATE grant to include `preferred_currency`;
     without it the column cannot be updated at all and the "allowed before
     records exist" case could never happen.

2. Deletion behavior (explicit)
   - The check counts records live on every currency change, so the rule is
     symmetric: if all transactions, bill payments, and budgets are deleted,
     currency changes become allowed again; if any of the three exist, changes
     are blocked.
   - Consequence by design: bill_payments rows cannot be deleted by users
     (read-only for clients) and RESTRICT prevents deleting transactions
     linked to a payment, so a user with bill-payment history is permanently
     blocked from changing currency. Users who only recorded transactions or
     budgets can delete those and regain the ability to change currency.

3. Concurrency protection
   - The race: a currency-update transaction counts zero financial records
     while a concurrent transaction/budget/bill-payment insert is still
     uncommitted. Without coordination both commit — a changed currency AND a
     financial record — violating the rule.
   - Chosen strategy: coordinate on the user's profile row.
     - The currency change is an UPDATE of the user's profile row, which
       already locks that row in FOR NO KEY UPDATE mode before this trigger
       runs.
     - New BEFORE INSERT triggers on `transactions`, `budgets`, and
       `bill_payments` first take a FOR SHARE row lock on the acting user's
       profile row. FOR SHARE conflicts with FOR NO KEY UPDATE, so the two
       operations cannot overlap: whichever transaction locks the profile row
       first finishes (commits or rolls back) before the other's locked step
       proceeds.
     - Ordering guarantees correctness both ways: if the record insert commits
       first, the currency update's count sees it and rejects the change; if
       the currency change commits first, the waiting insert proceeds and the
       record is created only after the currency change — at which point zero
       records existed, so allowing the change was correct.
   - Why not LOCK TABLE ... IN SHARE MODE: table-level locks on
     `bill_payments` require write privileges the authenticated role must not
     hold (that table is intentionally read-only for clients), so a plain
     table lock cannot be taken by the invoker without granting new write
     privileges. The profile-row approach needs only privileges already
     granted, adds no SECURITY DEFINER surface, and does not pause other
     users' writes on shared tables.
   - Deadlock safety: record-creating operations acquire the profile-row lock
     first and never wait on anything the currency change holds; the currency
     change waits only on in-flight record writers, never the reverse. No
     cycle can form. Repeated FOR SHARE requests inside one transaction (the
     payment RPC inserts a transaction and then a payment) are compatible with
     themselves.
   - RLS and privileges unchanged: the trigger functions remain
     INVOKER-rights. When a client insert fires the trigger, RLS already
     limits the caller to their own profile row for the lock; a caller naming
     another user's id gets no row (RLS) and the insert is rejected by RLS
     immediately after — no cross-user probing is possible.

4. Objects modified/added
   - `public.enforce_currency_immutable()` — replaced: unchanged-currency
     updates pass through untouched; changing currency counts the user's
     transactions, bill payments, and budgets (owner derived from the row
     being updated, never client input) and rejects the change if any exist.
   - `public.lock_profile_for_financial_record()` — new trigger function that
     takes the FOR SHARE lock on the acting user's profile row.
   - New BEFORE INSERT triggers: `transactions_lock_profile`,
     `budgets_lock_profile`, `bill_payments_lock_profile`.
   - Grant change: profiles UPDATE column list extended with
     `preferred_currency` for `authenticated`.

5. Assumptions and notes
   - Designed for READ COMMITTED (the Supabase/PostgreSQL default); the lock
     ordering, not isolation level, provides the serialization.
   - This migration must not be bundled with unrelated changes.
   - Safe to re-run (`create or replace`, `drop trigger if exists`).
   - ADR-011 is the authoritative decision; this migration implements it.
*/

-- Allow the currency column itself to be updated (the trigger governs when).
grant update (display_name, timezone, preferred_currency)
  on public.profiles to authenticated;

create or replace function public.enforce_currency_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_financial_record_count bigint;
begin
  if new.preferred_currency is not distinct from old.preferred_currency then
    return new;
  end if;

  -- The profile row is already locked (FOR NO KEY UPDATE) by this UPDATE.
  -- Record-creating triggers hold/seek FOR SHARE on the same row, so any
  -- concurrent record insert has either committed (visible below) or waits
  -- until after this transaction ends.
  select
    (select count(*) from public.transactions where user_id = old.id)
    + (select count(*) from public.bill_payments where user_id = old.id)
    + (select count(*) from public.budgets where user_id = old.id)
  into v_financial_record_count;

  if v_financial_record_count > 0 then
    raise exception 'preferred_currency cannot be changed once financial records exist'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.lock_profile_for_financial_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- FOR SHARE on the acting user's profile row serializes record creation
  -- against the currency-change UPDATE (FOR NO KEY UPDATE). Invoker-rights:
  -- RLS limits the lock to the caller's own profile row.
  perform 1
  from public.profiles
  where id = new.user_id
  for share;

  return new;
end;
$$;

drop trigger if exists transactions_lock_profile on public.transactions;
create trigger transactions_lock_profile
before insert on public.transactions
for each row execute function public.lock_profile_for_financial_record();

drop trigger if exists budgets_lock_profile on public.budgets;
create trigger budgets_lock_profile
before insert on public.budgets
for each row execute function public.lock_profile_for_financial_record();

drop trigger if exists bill_payments_lock_profile on public.bill_payments;
create trigger bill_payments_lock_profile
before insert on public.bill_payments
for each row execute function public.lock_profile_for_financial_record();
