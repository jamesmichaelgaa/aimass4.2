import { supabase } from "./supabase";
import { amountToCents, centsToDecimalString, monthRange, type Category } from "./types";

export interface BudgetRow {
  id: string;
  category_id: string | null;
  category_name: string | null;
  month: string; // YYYY-MM-01
  limit_amount: string;
}

export interface BudgetWithProgress extends BudgetRow {
  spent: string;
  remaining: string;
  percentUsed: number; // 0-999+; computed only
}

export interface BudgetsResult {
  budgets: BudgetRow[];
  error: string | null;
}

export async function fetchBudgets(monthYm: string): Promise<BudgetsResult> {
  try {
    const { data, error } = await supabase
      .from("budgets")
      .select("id,category_id,month,limit_amount,categories(name)")
      .eq("month", `${monthYm}-01`)
      .order("category_id");
    if (error) {
      return { budgets: [], error: "Could not load budgets. Please try again." };
    }
    const budgets = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const category = row.categories as { name: string } | null;
      return {
        id: String(row.id),
        category_id: typeof row.category_id === "string" ? row.category_id : null,
        category_name: category ? category.name : null,
        month: String(row.month),
        limit_amount: String(row.limit_amount),
      };
    });
    return { budgets, error: null };
  } catch {
    return { budgets: [], error: "Could not load budgets. Please check your connection and try again." };
  }
}

export interface ExpensesByCategory {
  overall: string;
  byCategory: Map<string, string>;
  error: string | null;
}

export async function fetchExpenseTotals(from: string, to: string): Promise<ExpensesByCategory> {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("amount,category_id")
      .eq("kind", "expense")
      .gte("transaction_date", from)
      .lte("transaction_date", to);
    if (error) {
      return { overall: "0.00", byCategory: new Map(), error: "Could not load spending totals. Please try again." };
    }
    let overallCents = 0n;
    const byCategory = new Map<string, bigint>();
    for (const row of data ?? []) {
      const cents = amountToCents(String(row.amount));
      overallCents += cents;
      if (typeof row.category_id === "string") {
        byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0n) + cents);
      }
    }
    const byCategoryStrings = new Map<string, string>();
    for (const [id, cents] of byCategory) {
      byCategoryStrings.set(id, centsToDecimalString(cents));
    }
    return { overall: centsToDecimalString(overallCents), byCategory: byCategoryStrings, error: null };
  } catch {
    return { overall: "0.00", byCategory: new Map(), error: "Could not load spending totals. Please check your connection and try again." };
  }
}

export interface SaveBudgetResult {
  error: string | null;
}

function mapBudgetError(message: string): string {
  if (message.includes("budgets_one_overall_per_user_month")) {
    return "You already have an overall budget for this month.";
  }
  if (message.includes("budgets_one_per_category_month")) {
    return "This category already has a budget for this month.";
  }
  if (message.includes("budgets_limit_amount_check")) {
    return "The budget amount must be greater than zero.";
  }
  if (message.includes("budgets_month_check")) {
    return "Invalid month.";
  }
  if (message.includes("budgets_category_same_user_fk") || message.includes("foreign key") || message.includes("categories")) {
    return "That category could not be used. Refresh the page and try again.";
  }
  if (message.includes("row-level security")) {
    return "You do not have permission to change that.";
  }
  return "Something went wrong. Please try again.";
}

export async function saveBudget(
  monthYm: string,
  categoryId: string | null,
  limitAmount: string,
  existingId: string | null
): Promise<SaveBudgetResult> {
  try {
    if (existingId) {
      const { error } = await supabase
        .from("budgets")
        .update({ limit_amount: limitAmount })
        .eq("id", existingId);
      if (error) {
        return { error: mapBudgetError(error.message) };
      }
      return { error: null };
    }
    const { error } = await supabase.from("budgets").insert({
      month: `${monthYm}-01`,
      category_id: categoryId,
      limit_amount: limitAmount,
    });
    if (error) {
      return { error: mapBudgetError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function deleteBudget(id: string): Promise<SaveBudgetResult> {
  try {
    const { error } = await supabase.from("budgets").delete().eq("id", id);
    if (error) {
      return { error: mapBudgetError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

// Attaches progress to each budget for a month: spent comes from actual
// expense transactions in that month only (never estimated or AI-derived).
export function computeProgress(
  budgets: BudgetRow[],
  expenses: ExpensesByCategory
): BudgetWithProgress[] {
  return budgets.map((budget) => {
    const spent = budget.category_id
      ? expenses.byCategory.get(budget.category_id) ?? "0.00"
      : expenses.overall;
    const limitCents = amountToCents(budget.limit_amount);
    const spentCents = amountToCents(spent);
    const remaining = centsToDecimalString(limitCents - spentCents);
    const percentUsed = limitCents === 0n ? 0 : Number((spentCents * 10000n) / limitCents) / 100;
    return { ...budget, spent, remaining, percentUsed };
  });
}

export type BudgetStatus = "over" | "warning" | "ok";

export function budgetStatus(b: BudgetWithProgress): BudgetStatus {
  if (b.percentUsed >= 100) {
    return "over";
  }
  if (b.percentUsed >= 80) {
    return "warning";
  }
  return "ok";
}

export interface MonthOption {
  ym: string;
  label: string;
}

// A rolling window of months around the current one for the month picker.
export function buildMonthOptions(count = 12): MonthOption[] {
  const now = new Date();
  const options: MonthOption[] = [];
  for (let offset = -6; offset <= count - 7; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push({ ym, label: d.toLocaleDateString("en-PH", { month: "long", year: "numeric" }) });
  }
  return options;
}

export function isCurrentMonth(ym: string): boolean {
  const now = new Date();
  return ym === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function monthBounds(ym: string): { start: string; end: string } {
  return monthRange(ym);
}

export function categoriesForBudgetPicker(expenseCategories: Category[]): Category[] {
  return [...expenseCategories].sort((a, b) => a.name.localeCompare(b.name));
}
