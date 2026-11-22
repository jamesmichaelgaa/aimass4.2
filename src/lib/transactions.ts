import { supabase } from "./supabase";
import { diffAmounts, sumAmounts, type Category, type Summary, type TransactionRow } from "./types";

export interface TransactionFilters {
  from: string | null;
  to: string | null;
  kind: "income" | "expense" | null;
  categoryId: string | null;
}

const TX_COLUMNS = "id,kind,amount,transaction_date,description,category_id,created_at";

function mapRow(row: Record<string, unknown>): TransactionRow {
  const category = row.categories as { name: string } | null;
  return {
    id: String(row.id),
    kind: row.kind === "income" ? "income" : "expense",
    amount: String(row.amount),
    transaction_date: String(row.transaction_date),
    description: typeof row.description === "string" ? row.description : null,
    category_id: typeof row.category_id === "string" ? row.category_id : null,
    category_name: category ? category.name : null,
    created_at: String(row.created_at),
  };
}

export interface FetchTransactionsResult {
  rows: TransactionRow[];
  error: string | null;
}

export async function fetchTransactions(filters: TransactionFilters): Promise<FetchTransactionsResult> {
  try {
    let query = supabase
      .from("transactions")
      .select(`${TX_COLUMNS},categories(name)`)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (filters.from) {
      query = query.gte("transaction_date", filters.from);
    }
    if (filters.to) {
      query = query.lte("transaction_date", filters.to);
    }
    if (filters.kind) {
      query = query.eq("kind", filters.kind);
    }
    if (filters.categoryId) {
      query = query.eq("category_id", filters.categoryId);
    }
    const { data, error } = await query;
    if (error) {
      return { rows: [], error: "Could not load transactions. Please try again." };
    }
    return { rows: (data ?? []).map((row) => mapRow(row as Record<string, unknown>)), error: null };
  } catch {
    return { rows: [], error: "Could not load transactions. Please check your connection and try again." };
  }
}

export async function fetchMonthSummary(from: string, to: string): Promise<Summary | { error: string }> {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("kind,amount")
      .gte("transaction_date", from)
      .lte("transaction_date", to);
    if (error) {
      return { error: "Could not load totals. Please try again." };
    }
    const rows = data ?? [];
    const income = sumAmounts(rows.filter((r) => r.kind === "income").map((r) => ({ amount: String(r.amount) })));
    const expense = sumAmounts(rows.filter((r) => r.kind === "expense").map((r) => ({ amount: String(r.amount) })));
    return { income, expense, net: diffAmounts(income, expense) };
  } catch {
    return { error: "Could not load totals. Please check your connection and try again." };
  }
}

export interface CategoriesResult {
  income: Category[];
  expense: Category[];
  error: string | null;
}

export async function fetchCategories(): Promise<CategoriesResult> {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("id,name,kind,is_system")
      .order("is_system", { ascending: false })
      .order("name", { ascending: true });
    if (error) {
      return { income: [], expense: [], error: "Could not load categories. Please try again." };
    }
    const all = (data ?? []) as Array<Record<string, unknown>>;
    const toCategory = (row: Record<string, unknown>): Category => ({
      id: String(row.id),
      name: String(row.name),
      kind: row.kind === "income" ? "income" : "expense",
      is_system: Boolean(row.is_system),
    });
    return {
      income: all.filter((row) => row.kind === "income").map(toCategory),
      expense: all.filter((row) => row.kind === "expense").map(toCategory),
      error: null,
    };
  } catch {
    return { income: [], expense: [], error: "Could not load categories. Please check your connection and try again." };
  }
}

export interface MutationResult {
  error: string | null;
}

function mapMutationError(message: string): string {
  if (message.includes("categories_user_id_name_kind_key") || message.includes("duplicate key")) {
    return "You already have a category with that name for this type.";
  }
  if (message.includes("row-level security")) {
    return "You do not have permission to change that.";
  }
  if (message.includes("foreign key") || message.includes("categories")) {
    return "That category could not be used. Refresh the page and try again.";
  }
  return "Something went wrong. Please try again.";
}

export async function createCategory(
  name: string,
  kind: "income" | "expense"
): Promise<MutationResult> {
  try {
    const { error } = await supabase.from("categories").insert({ name, kind });
    if (error) {
      return { error: mapMutationError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function deleteCategory(id: string): Promise<MutationResult> {
  try {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) {
      if (error.message.includes("foreign key") || error.message.includes("still referenced")) {
        return { error: "This category has transactions and cannot be deleted." };
      }
      return { error: mapMutationError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export interface TransactionInput {
  kind: "income" | "expense";
  amount: string; // decimal string
  transactionDate: string; // ISO
  categoryId: string | null;
  description: string | null;
}

export async function createTransaction(input: TransactionInput): Promise<MutationResult> {
  try {
    const { error } = await supabase.from("transactions").insert({
      kind: input.kind,
      amount: input.amount,
      transaction_date: input.transactionDate,
      category_id: input.categoryId,
      description: input.description,
    });
    if (error) {
      return { error: mapMutationError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<MutationResult> {
  try {
    const { error } = await supabase
      .from("transactions")
      .update({
        kind: input.kind,
        amount: input.amount,
        transaction_date: input.transactionDate,
        category_id: input.categoryId,
        description: input.description,
      })
      .eq("id", id);
    if (error) {
      return { error: mapMutationError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function deleteTransaction(id: string): Promise<MutationResult> {
  try {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      return { error: mapMutationError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}
