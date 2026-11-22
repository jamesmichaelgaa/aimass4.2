/*
# Fix advance_due_date month-end clamping (catch SQLSTATE 22008)

1. Plain-English explanation
   - Paying a bill whose next due date is on the 29th, 30th, or 31st failed with
     "date field value out of range" (SQLSTATE 22008) whenever the next month is
     shorter, e.g. a monthly bill due Jan 31 could never be marked paid because
     computing Feb 31 raised an unhandled error. The clamping loop intended to
     handle this caught the WRONG error code (`numeric_value_out_of_range`,
     22003), which `make_date` never raises for an invalid day — it raises
     22008 (`datetime field overflow`).
   - This migration replaces only the `advance_due_date` recurrence helper so
     its clamping loop catches SQLSTATE 22008 (and still 22003 defensively),
     decrementing the day until `make_date` succeeds (Feb 31 → Feb 28, Apr 31 →
     Apr 30, Feb 29 → Feb 28 on non-leap years). This matches the documented
     contract in docs/testing-plan-financial.md (R-03/R-04) and the
     application-side forecast mirror (addMonthsClamped).

2. Functions modified
   - `public.advance_due_date(text, date)` — clamping loop now catches
     SQLSTATE '22008' in addition to `numeric_value_out_of_range`.

3. Security
   - No change: the function keeps `immutable` and its pinned empty
     `search_path`; CREATE OR REPLACE preserves the existing EXECUTE ACLs
     (execute already revoked from public/anon; no grants added).

4. Important notes
   - No tables, columns, policies, or table grants change.
   - Behavior is otherwise unchanged; weekly is still +7 days.
   - Safe to re-run (create-or-replace).
*/

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
  -- make_date raises SQLSTATE 22008 for an invalid day-of-month (not 22003).
  loop
    begin
      return make_date(v_year, v_month, v_day);
    exception
      when SQLSTATE '22008' then
        v_day := v_day - 1;
        if v_day < 28 then
          raise exception 'failed to compute next due date';
        end if;
      when numeric_value_out_of_range then
        v_day := v_day - 1;
        if v_day < 28 then
          raise exception 'failed to compute next due date';
        end if;
    end;
  end loop;
end;
$$;
