import { supabase } from "./supabase";
import { isValidDate, parseNonNegativeDecimalString, type CashPosition } from "./types";

export type ValidatedCashInput =
  | { ok: true; amount: string; asOfDate: string }
  | { ok: false; errors: { amount?: string; date?: string } };

// Exact-cent validation shared by Settings and the Forecast page.
export function validateCashInput(amountRaw: string, asOfRaw: string): ValidatedCashInput {
  const errors: { amount?: string; date?: string } = {};
  const amount = parseNonNegativeDecimalString(amountRaw);
  if (amount === null) {
    errors.amount = "Enter your available cash as 0 or more, with up to two decimals (for example 8500 or 8500.50).";
  }
  if (!isValidDate(asOfRaw)) {
    errors.date = "Enter the date the balance was accurate.";
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, amount: amount as string, asOfDate: asOfRaw };
}

export async function fetchCashPosition(): Promise<CashPosition | null> {
  const { data, error } = await supabase.from("cash_positions").select("*").maybeSingle();
  if (error) {
    throw new Error("fetch-cash-failed");
  }
  return (data as CashPosition | null) ?? null;
}

// Upserts the user's single cash position row. The owner column defaults to
// auth.uid() in the database; it is never sent from the client.
export async function saveCashPosition(amount: string, asOfDate: string): Promise<string | null> {
  try {
    const { error } = await supabase
      .from("cash_positions")
      .upsert({ amount, as_of_date: asOfDate }, { onConflict: "user_id" });
    if (error) {
      if (error.message.includes("cash_positions_amount_check")) {
        return "The cash amount cannot be negative.";
      }
      if (error.message.includes("row-level security")) {
        return "You do not have permission to change that.";
      }
      return "Could not save your cash position. Please try again.";
    }
    return null;
  } catch {
    return "Could not save your cash position. Please check your connection and try again.";
  }
}
