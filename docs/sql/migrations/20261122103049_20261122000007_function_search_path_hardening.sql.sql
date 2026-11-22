/*
# Search-path hardening for validation and recurrence helpers

1. Plain-English explanation
   - Pins a fixed empty `search_path` on the remaining helper functions so none
     of them can be redirected to a different schema at call time. This closes
     the linter's "function search path mutable" warnings.

2. Functions hardened
   - `public.enforce_currency_immutable()` (profiles currency-change block)
   - `public.assert_budget_category_is_expense()` (budget category validation)
   - `public.assert_bill_category_is_expense()` (bill category validation)
   - `public.advance_due_date(text, date)` (bill recurrence date advancement)

3. Security
   - Behavior is unchanged; each function now references objects with explicit
     schema qualification and cannot be hijacked via search-path manipulation.

4. Important notes
   - `mark_bill_occurrence_paid` and `handle_new_user` already had a fixed
     `search_path`; `set_updated_at` was fixed in the helpers migration.
   - No tables, policies, or grants change in this migration.
   - This migration is safe to re-run.
*/

create or replace function public.enforce_currency_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.preferred_currency is distinct from old.preferred_currency then
    raise exception 'preferred_currency is fixed in the MVP and cannot be changed'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function public.assert_budget_category_is_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_kind text;
begin
  if new.category_id is null then
    return new;
  end if;

  select kind into category_kind
  from public.categories
  where id = new.category_id;

  if category_kind is null or category_kind <> 'expense' then
    raise exception 'budget category must exist and be an expense category'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create or replace function public.assert_bill_category_is_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_kind text;
begin
  if new.category_id is null then
    return new;
  end if;

  select kind into category_kind
  from public.categories
  where id = new.category_id;

  if category_kind is null or category_kind <> 'expense' then
    raise exception 'recurring bill category must exist and be an expense category'
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create or replace function public.advance_due_date(
  p_frequency text,
  p_due_date date
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_year int;
  v_month int;
  v_day int;
begin
  case p_frequency
    when 'weekly' then
      return p_due_date + 7;
    when 'monthly' then
      v_year := extract(year from p_due_date)::int;
      v_month := extract(month from p_due_date)::int + 1;
      if v_month > 12 then
        v_month := v_month - 12;
        v_year := v_year + 1;
      end if;
    when 'quarterly' then
      v_year := extract(year from p_due_date)::int;
      v_month := extract(month from p_due_date)::int + 3;
      if v_month > 12 then
        v_month := v_month - 12;
        v_year := v_year + 1;
      end if;
    when 'yearly' then
      v_year := extract(year from p_due_date)::int + 1;
      v_month := extract(month from p_due_date)::int;
    else
      raise exception 'unknown bill frequency: %', p_frequency;
  end case;

  v_day := extract(day from p_due_date)::int;

  -- Clamp a day that does not exist in the destination month (e.g. the 31st
  -- advancing into a 30-day month) to that month's last calendar day.
  loop
    begin
      return make_date(v_year, v_month, v_day);
    exception when numeric_value_out_of_range then
      v_day := v_day - 1;
      if v_day < 28 then
        raise exception 'failed to compute next due date';
      end if;
    end;
  end loop;
end;
$$;
