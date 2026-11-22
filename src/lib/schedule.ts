import { supabase } from "./supabase";
import { isValidDate, parseAmountToDecimalString, type IncomeSchedule, type SalaryFrequency } from "./types";

export function isSalaryFrequency(value: string): value is SalaryFrequency {
  return value === "monthly" || value === "biweekly";
}

export interface ScheduleInput {
  amountRaw: string;
  frequency: string;
  nextPayday: string;
}

export type ValidatedScheduleInput =
  | { ok: true; amount: string; frequency: SalaryFrequency; nextPayday: string }
  | { ok: false; errors: { amount?: string; payday?: string; frequency?: string } };

// Exact-cent validation: the amount stays a decimal string end to end.
export function validateScheduleInput(input: ScheduleInput): ValidatedScheduleInput {
  const errors: { amount?: string; payday?: string; frequency?: string } = {};
  const amount = parseAmountToDecimalString(input.amountRaw);
  if (amount === null) {
    errors.amount = "Enter your expected salary as a positive amount with up to two decimals, e.g. 25000 or 25000.50.";
  }
  if (!isValidDate(input.nextPayday)) {
    errors.payday = "Enter a valid date.";
  }
  if (!isSalaryFrequency(input.frequency)) {
    errors.frequency = "Choose monthly or biweekly.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    amount: amount as string,
    frequency: input.frequency as SalaryFrequency,
    nextPayday: input.nextPayday,
  };
}

export async function fetchActiveSchedule(): Promise<IncomeSchedule | null> {
  const { data, error } = await supabase
    .from("income_schedules")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    throw new Error("fetch-schedule-failed");
  }
  return (data as IncomeSchedule | null) ?? null;
}

// Saves the user's own schedule: updates the active row in place when one
// exists (RLS scopes the update to its owner), otherwise inserts one. The
// owner column defaults to auth.uid() in the database; it is never sent.
export async function saveSchedule(
  input: { amount: string; frequency: SalaryFrequency; nextPayday: string },
  existing: IncomeSchedule | null
): Promise<string | null> {
  try {
    if (existing) {
      const { error } = await supabase
        .from("income_schedules")
        .update({
          expected_amount: input.amount,
          frequency: input.frequency,
          next_payday: input.nextPayday,
        })
        .eq("id", existing.id);
      if (error) {
        if (error.message.includes("income_schedules_expected_amount_check")) {
          return "The salary amount must be greater than zero.";
        }
        if (error.message.includes("row-level security")) {
          return "You do not have permission to change that schedule.";
        }
        return "Could not save your salary schedule. Please try again.";
      }
      return null;
    }
    const { error } = await supabase.from("income_schedules").insert({
      label: "Salary",
      expected_amount: input.amount,
      frequency: input.frequency,
      next_payday: input.nextPayday,
      is_active: true,
    });
    if (error) {
      return "Could not save your salary schedule. Please try again.";
    }
    return null;
  } catch {
    return "Something went wrong. Please try again.";
  }
}
