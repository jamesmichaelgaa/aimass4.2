import { supabase } from "./supabase";

export type BillFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

export interface RecurringBill {
  id: string;
  name: string;
  amount: string;
  frequency: BillFrequency;
  next_due_date: string;
  is_active: boolean;
  category_id: string | null;
  category_name: string | null;
}

export interface BillPayment {
  id: string;
  due_date: string;
  transaction_id: string;
  amount: string;
  transaction_date: string | null;
  description: string | null;
}

export function isBillFrequency(value: string): value is BillFrequency {
  return value === "weekly" || value === "monthly" || value === "quarterly" || value === "yearly";
}

export const FREQUENCY_LABELS: Record<BillFrequency, string> = {
  weekly: "Every week",
  monthly: "Every month",
  quarterly: "Every 3 months",
  yearly: "Every year",
};

export type BillStatus = "overdue" | "due-today" | "upcoming" | "paid-current" | "inactive";

// A bill's reminder state relative to today, using calendar-date comparison.
export function billStatus(bill: RecurringBill, todayIso: string): BillStatus {
  if (!bill.is_active) {
    return "inactive";
  }
  if (bill.next_due_date < todayIso) {
    return "overdue";
  }
  if (bill.next_due_date === todayIso) {
    return "due-today";
  }
  return "upcoming";
}

const BILL_COLUMNS = "id,name,amount,frequency,next_due_date,is_active,category_id";

function mapBill(row: Record<string, unknown>): RecurringBill {
  const category = row.categories as { name: string } | null;
  const frequency = typeof row.frequency === "string" && isBillFrequency(row.frequency) ? row.frequency : "monthly";
  return {
    id: String(row.id),
    name: String(row.name),
    amount: String(row.amount),
    frequency,
    next_due_date: String(row.next_due_date),
    is_active: Boolean(row.is_active),
    category_id: typeof row.category_id === "string" ? row.category_id : null,
    category_name: category ? category.name : null,
  };
}

export interface BillsResult {
  bills: RecurringBill[];
  error: string | null;
}

export async function fetchBills(): Promise<BillsResult> {
  try {
    const { data, error } = await supabase
      .from("recurring_bills")
      .select(`${BILL_COLUMNS},categories(name)`)
      .order("next_due_date", { ascending: true });
    if (error) {
      return { bills: [], error: "Could not load bills. Please try again." };
    }
    return { bills: (data ?? []).map((row) => mapBill(row as Record<string, unknown>)), error: null };
  } catch {
    return { bills: [], error: "Could not load bills. Please check your connection and try again." };
  }
}

export async function fetchBillPayments(billId: string): Promise<{ payments: BillPayment[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from("bill_payments")
      .select("id,due_date,transaction_id,transactions(amount,transaction_date,description)")
      .eq("recurring_bill_id", billId)
      .order("due_date", { ascending: false });
    if (error) {
      return { payments: [], error: "Could not load payment history. Please try again." };
    }
    const payments = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const tx = row.transactions as { amount: string; transaction_date: string; description: string | null } | null;
      return {
        id: String(row.id),
        due_date: String(row.due_date),
        transaction_id: String(row.transaction_id),
        amount: tx ? String(tx.amount) : "0.00",
        transaction_date: tx ? String(tx.transaction_date) : null,
        description: tx ? tx.description : null,
      };
    });
    return { payments, error: null };
  } catch {
    return { payments: [], error: "Could not load payment history. Please check your connection and try again." };
  }
}

export interface BillInput {
  name: string;
  amount: string; // decimal string
  frequency: BillFrequency;
  nextDueDate: string; // ISO
  categoryId: string | null;
}

function mapBillMutationError(message: string): string {
  if (message.includes("recurring_bills_amount_check")) {
    return "The bill amount must be greater than zero.";
  }
  if (message.includes("recurring_bills_frequency_check")) {
    return "Choose a valid frequency.";
  }
  if (message.includes("recurring_bills_category_same_user_fk") || message.includes("foreign key")) {
    return "That category could not be used. Refresh the page and try again.";
  }
  if (message.includes("recurring_bills_assert_category_expense")) {
    return "Bills can only be linked to expense categories.";
  }
  if (message.includes("row-level security")) {
    return "You do not have permission to change that.";
  }
  return "Something went wrong. Please try again.";
}

export interface MutationResult {
  error: string | null;
}

export async function createBill(input: BillInput): Promise<MutationResult> {
  try {
    const { error } = await supabase.from("recurring_bills").insert({
      name: input.name,
      amount: input.amount,
      frequency: input.frequency,
      next_due_date: input.nextDueDate,
      category_id: input.categoryId,
    });
    if (error) {
      return { error: mapBillMutationError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function updateBill(id: string, input: BillInput): Promise<MutationResult> {
  try {
    const { error } = await supabase
      .from("recurring_bills")
      .update({
        name: input.name,
        amount: input.amount,
        frequency: input.frequency,
        next_due_date: input.nextDueDate,
        category_id: input.categoryId,
      })
      .eq("id", id);
    if (error) {
      return { error: mapBillMutationError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export async function setBillActive(id: string, isActive: boolean): Promise<MutationResult> {
  try {
    const { error } = await supabase.from("recurring_bills").update({ is_active: isActive }).eq("id", id);
    if (error) {
      return { error: mapBillMutationError(error.message) };
    }
    return { error: null };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}

export interface MarkPaidResult {
  error: string | null;
}

// Single payment operation: calls the atomic SECURITY DEFINER RPC, which
// creates/links the expense transaction, records the payment, and advances
// the due date in one transaction. The frontend never writes bill_payments
// or pre-creates the expense.
export async function markOccurrencePaid(
  billId: string,
  dueDate: string,
  options: { categoryId: string | null; description: string | null; amountOverride: string | null }
): Promise<MarkPaidResult> {
  try {
    const { data, error } = await supabase.rpc("mark_bill_occurrence_paid", {
      p_recurring_bill_id: billId,
      p_due_date: dueDate,
      p_category_id: options.categoryId,
      p_description: options.description,
      p_amount: options.amountOverride === null ? null : options.amountOverride,
    });
    if (error) {
      const message = error.message;
      if (message.includes("already been paid")) {
        return { error: "This occurrence was already paid (possibly from another device). The list will refresh." };
      }
      if (message.includes("beyond the next scheduled")) {
        return { error: "That occurrence is no longer the next one due. The list will refresh." };
      }
      if (message.includes("not active")) {
        return { error: "This bill is inactive and cannot be paid. Reactivate it first." };
      }
      if (message.includes("positive amount")) {
        return { error: "Enter an amount greater than zero." };
      }
      return { error: "Could not record the payment. Please try again." };
    }
    const rows = (data ?? []) as Array<{ bill_payment_id: string; linked_transaction_id: string }>;
    if (rows.length === 0) {
      return { error: "The payment could not be recorded. Please try again." };
    }
    return { error: null };
  } catch {
    return { error: "Could not record the payment. Please check your connection and try again." };
  }
}
