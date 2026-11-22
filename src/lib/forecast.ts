import { addSignedAmounts, amountToCents, centsToDecimalString, isValidDate } from "./types";
import { fetchBills, type RecurringBill } from "./bills";
import { fetchTransactions, type TransactionFilters } from "./transactions";
import type { IncomeSchedule } from "./types";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Date progression (ADR-005): monthly = calendar-month with last-day clamping,
// biweekly = exactly every 14 days. Pure functions, deterministic.
// ---------------------------------------------------------------------------

export function addMonthsClamped(isoDate: string, months: number): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !m[1] || !m[2] || !m[3]) {
    return isoDate;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const totalMonths = (year * 12 + (month - 1)) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(newYear, newMonth, 0).getDate();
  const newDay = Math.min(day, lastDay);
  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-${String(newDay).padStart(2, "0")}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addYearsClamped(isoDate: string, years: number): string {
  return addMonthsClamped(isoDate, years * 12);
}

// Next payday strictly AFTER the given date, per the schedule's frequency.
export function nextPaydayAfter(schedule: IncomeSchedule, afterIso: string): string {
  let cursor = schedule.next_payday;
  const stepMonths = schedule.frequency === "monthly" ? 1 : 0;
  while (cursor <= afterIso) {
    cursor = stepMonths === 1 ? addMonthsClamped(cursor, 1) : addDays(cursor, 14);
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Recurring bill occurrence projection (mirrors the DB's advance_due_date
// semantics: weekly +7d; monthly/quarterly/yearly calendar-month steps with
// last-day clamping).
// ---------------------------------------------------------------------------

export function nextBillDueAfter(bill: Pick<RecurringBill, "frequency" | "next_due_date">, afterIso: string): string {
  let cursor = bill.next_due_date;
  let guard = 0;
  while (cursor <= afterIso && guard < 400) {
    if (bill.frequency === "weekly") {
      cursor = addDays(cursor, 7);
    } else if (bill.frequency === "monthly") {
      cursor = addMonthsClamped(cursor, 1);
    } else if (bill.frequency === "quarterly") {
      cursor = addMonthsClamped(cursor, 3);
    } else {
      cursor = addYearsClamped(cursor, 1);
    }
    guard++;
  }
  return cursor;
}

export interface BillOccurrence {
  billId: string;
  billName: string;
  dueDate: string;
  amount: string;
  categoryId: string | null;
}

// Unpaid occurrences of active bills with due date in (asOfDate, cutoff].
// Occurrences already paid are represented by their linked expense
// transactions (which the transaction query already counts) and are skipped.
export function unpaidBillOccurrences(
  bills: RecurringBill[],
  paidKeys: Set<string>,
  asOfDate: string,
  cutoff: string
): BillOccurrence[] {
  const occurrences: BillOccurrence[] = [];
  for (const bill of bills) {
    if (!bill.is_active) {
      continue;
    }
    let cursor = nextBillDueAfter(bill, asOfDate);
    let guard = 0;
    while (cursor <= cutoff && guard < 60) {
      if (!paidKeys.has(`${bill.id}:${cursor}`)) {
        occurrences.push({
          billId: bill.id,
          billName: bill.name,
          dueDate: cursor,
          amount: bill.amount,
          categoryId: bill.category_id,
        });
      }
      if (bill.frequency === "weekly") {
        cursor = addDays(cursor, 7);
      } else if (bill.frequency === "monthly") {
        cursor = addMonthsClamped(cursor, 1);
      } else if (bill.frequency === "quarterly") {
        cursor = addMonthsClamped(cursor, 3);
      } else {
        cursor = addYearsClamped(cursor, 1);
      }
      guard++;
    }
  }
  return occurrences.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// ---------------------------------------------------------------------------
// Salary reconciliation (docs/salary-reconciliation.md)
// ---------------------------------------------------------------------------

export interface SalaryMatch {
  transactionId: string;
}

export function findReconcilingSalaryTransaction(
  transactions: Array<{ id: string; kind: string; amount: string; transaction_date: string; category_id: string | null; created_at: string }>,
  schedule: IncomeSchedule,
  payday: string,
  salaryCategoryId: string | null
): SalaryMatch | null {
  if (!salaryCategoryId) {
    return null;
  }
  const windowStart = addDays(payday, -3);
  const expectedCents = amountToCents(schedule.expected_amount);
  const candidates = transactions
    .filter((t) => {
      if (t.kind !== "income" || t.category_id !== salaryCategoryId) {
        return false;
      }
      if (t.transaction_date < windowStart || t.transaction_date > payday) {
        return false;
      }
      const diff = amountToCents(t.amount) - expectedCents;
      const absDiff = diff < 0n ? -diff : diff;
      return absDiff <= 1n; // cent-level tolerance
    })
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.created_at.localeCompare(b.created_at));
  const first = candidates[0];
  return first ? { transactionId: String(first.id) } : null;
}

// ---------------------------------------------------------------------------
// Forecast assembly
// ---------------------------------------------------------------------------

export interface ForecastEvent {
  date: string;
  kind: "start" | "income" | "expense" | "expected-salary" | "bill" | "end";
  label: string;
  amount: string; // signed decimal string
}

export interface ForecastResult {
  ok: true;
  asOfDate: string;
  startDate: string;
  endDate: string;
  startingCash: string;
  recordedIncome: string;
  recordedExpenses: string;
  expectedSalary: string;
  expectedSalaryReconciled: boolean;
  unpaidBills: BillOccurrence[];
  estimatedEndingCash: string;
  events: ForecastEvent[];
  warnings: string[];
}

export interface ForecastUnavailable {
  ok: false;
  reason: "no-cash-position" | "no-schedule" | "bad-dates";
  message: string;
}

export const SALARY_CATEGORY_NAME = "salary";

// PostgREST returns numeric columns as JSON numbers; every money value is
// normalized to a decimal string so all downstream math is string-based.
function asDecimalString(value: string | number): string {
  return typeof value === "number" ? value.toFixed(2) : String(value);
}

async function fetchSalaryCategoryId(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("id")
      .eq("kind", "income")
      .eq("is_system", true)
      .ilike("name", SALARY_CATEGORY_NAME)
      .limit(1);
    if (error || !data || data.length === 0) {
      return null;
    }
    const first = data[0];
    return first ? String(first.id) : null;
  } catch {
    return null;
  }
}

interface PaidKeyRow {
  recurring_bill_id: string;
  due_date: string;
}

async function fetchPaidOccurrenceKeys(billIds: string[], from: string, to: string): Promise<Set<string>> {
  const keys = new Set<string>();
  if (billIds.length === 0) {
    return keys;
  }
  try {
    const { data, error } = await supabase
      .from("bill_payments")
      .select("recurring_bill_id,due_date")
      .in("recurring_bill_id", billIds)
      .gte("due_date", from)
      .lte("due_date", to);
    if (error) {
      return keys;
    }
    for (const row of (data ?? []) as PaidKeyRow[]) {
      keys.add(`${row.recurring_bill_id}:${row.due_date}`);
    }
  } catch {
    return keys;
  }
  return keys;
}

export async function computeForecast(schedule: IncomeSchedule, cashAmount: string | number, cashAsOf: string): Promise<ForecastResult | ForecastUnavailable> {
  // PostgREST serializes numeric as JSON numbers; every money value is
  // normalized to a decimal string here so all downstream math is string-based.
  const scheduleSafe: IncomeSchedule = {
    ...schedule,
    expected_amount: asDecimalString(schedule.expected_amount),
  };
  const cashAmountSafe = asDecimalString(cashAmount);
  if (!isValidDate(cashAsOf) || !isValidDate(scheduleSafe.next_payday)) {
    return { ok: false, reason: "bad-dates", message: "Your cash position date or payday is not a valid date. Fix it in Settings or onboarding." };
  }

  const payday = nextPaydayAfter(scheduleSafe, cashAsOf);

  // Recorded activity strictly after the as-of date through the payday.
  const filters: TransactionFilters = { from: addDays(cashAsOf, 1), to: payday, kind: null, categoryId: null };
  const txResult = await fetchTransactions(filters);
  if (txResult.error) {
    return { ok: false, reason: "bad-dates", message: txResult.error };
  }
  const transactions = txResult.rows.map((t) => ({ ...t, amount: asDecimalString(t.amount) }));

  const billsResult = await fetchBills();
  if (billsResult.error) {
    return { ok: false, reason: "bad-dates", message: billsResult.error };
  }
  const bills = billsResult.bills.map((b) => ({ ...b, amount: asDecimalString(b.amount) }));
  const paidKeys = await fetchPaidOccurrenceKeys(
    bills.map((b) => b.id),
    addDays(cashAsOf, 1),
    payday
  );
  const unpaid = unpaidBillOccurrences(bills, paidKeys, cashAsOf, payday);

  // Reconciliation: an already-recorded salary transaction for this payday
  // replaces the expected salary line (no double counting).
  const salaryCategoryId = await fetchSalaryCategoryId();
  const match = findReconcilingSalaryTransaction(
    transactions.map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: t.amount,
      transaction_date: t.transaction_date,
      category_id: t.category_id,
      created_at: t.created_at,
    })),
    scheduleSafe,
    payday,
    salaryCategoryId
  );

  const events: ForecastEvent[] = [
    { date: cashAsOf, kind: "start", label: "Starting cash (as of this date)", amount: cashAmountSafe },
  ];

  let recordedIncomeCents = 0n;
  let recordedExpenseCents = 0n;
  for (const t of transactions) {
    if (t.kind === "income") {
      recordedIncomeCents += amountToCents(t.amount);
      events.push({
        date: t.transaction_date,
        kind: "income",
        label: t.description ?? (t.category_name ? `Income — ${t.category_name}` : "Income"),
        amount: t.amount,
      });
    } else {
      recordedExpenseCents += amountToCents(t.amount);
      events.push({
        date: t.transaction_date,
        kind: "expense",
        label: t.description ?? (t.category_name ? `Expense — ${t.category_name}` : "Expense"),
        amount: `-${t.amount}`,
      });
    }
  }

  const expectedSalaryReconciled = match !== null;
  if (!expectedSalaryReconciled) {
    events.push({
      date: payday,
      kind: "expected-salary",
      label: "Expected salary (not yet received)",
      amount: scheduleSafe.expected_amount,
    });
  }

  for (const occ of unpaid) {
    events.push({
      date: occ.dueDate,
      kind: "bill",
      label: `Unpaid bill — ${occ.billName}`,
      amount: `-${occ.amount}`,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  const recordedIncome = centsToDecimalString(recordedIncomeCents);
  const recordedExpenses = centsToDecimalString(recordedExpenseCents);
  const billTotalCents = unpaid.reduce((acc, occ) => acc + amountToCents(occ.amount), 0n);
  const expectedSalaryAmount = expectedSalaryReconciled ? "0.00" : scheduleSafe.expected_amount;

  const estimatedEndingCash = addSignedAmounts([
    cashAmountSafe,
    recordedIncome,
    `-${recordedExpenses}`,
    expectedSalaryAmount,
    centsToDecimalString(-billTotalCents),
  ]);

  const warnings: string[] = [];
  if (estimatedEndingCash.startsWith("-")) {
    warnings.push("Projected cash goes negative before payday. Consider moving a bill or reducing spending.");
  }
  if (expectedSalaryReconciled) {
    warnings.push("A recorded salary transaction for this payday was found, so the expected salary is not counted twice.");
  }
  if (unpaid.length > 0) {
    warnings.push(`${unpaid.length} unpaid bill occurrence${unpaid.length === 1 ? "" : "s"} due before payday is included.`);
  }

  return {
    ok: true,
    asOfDate: cashAsOf,
    startDate: addDays(cashAsOf, 1),
    endDate: payday,
    startingCash: cashAmountSafe,
    recordedIncome,
    recordedExpenses,
    expectedSalary: expectedSalaryAmount,
    expectedSalaryReconciled,
    unpaidBills: unpaid,
    estimatedEndingCash,
    events,
    warnings,
  };
}
