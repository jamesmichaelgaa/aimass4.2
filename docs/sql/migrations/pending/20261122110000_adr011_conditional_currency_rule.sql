/*
# Conditional preferred-currency rule (ADR-011)

Status: PREPARED, NOT APPLIED. Apply through the Supabase migration tool only
after approval.

1. Plain-English explanation
   - Corrects the currency rule: users may change their preferred currency only
     while they have no financial records. Once they have any transactions,
     bill payments, or budgets, currency changes are blocked so historical
     amounts are never silently relabelled.
   - Replaces the previous blanket block with a conditional check.
   - All other profile updates (display name, timezone) are unaffected.

2. Functions modified
   - `public.enforce_currency_immutable()` — replaced with a conditional version:
     - On profile UPDATE, if `preferred_currency` is unchanged, the update
       proceeds normally (other fields stay editable).
     - If `preferred_currency` is changing, the function counts the caller's
       financial records: rows in `transactions`, `bill_payments`, and
       `budgets` for that user.
     - If any of those counts is greater than zero, the change is rejected with
       a clear error; otherwise it is allowed.
     - The profile owner is derived from the row being updated (`old.id` /
       `new.id`), never from client input. Profiles are owner-scoped by RLS
       (`id = auth.uid()`), so a signed-in user can only reach their own row;
       the trigger reads counts with the same row identity, so one user can
       never influence another user's currency decision.
   - Fixed empty `search_path` retained.

3. Security
   - RLS, ownership policies, and grants are NOT changed.
   - The trigger is INVOKER-rights: it runs with the caller's privileges, so
     counting the caller's own rows is subject to the caller's own RLS scope —
     it can only ever count rows the caller already owns. It cannot be used to
     probe other users' data.
   - No secrets or production data are embedded.

4. Important notes
   - This migration must not be bundled with unrelated changes.
   - Safe to re-run (`create or replace`).
   - ADR-011 is the authoritative decision; this migration implements it.
*/

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
