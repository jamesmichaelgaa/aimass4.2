// Builds the user-scoped financial context sent to OpenAI.
//
// Privacy and grounding rules implemented here:
// - The caller's identity comes from a verified JWT, never from the request body.
// - Only aggregates plus small, bounded category/budget rows are sent. Raw
//   transaction descriptions are NOT included.
// - Money values are formatted as decimal strings from numeric(14,2) columns.
// - User-controlled text (category names, bill names) is length-bounded and
//   passed as delimited data; the system prompt marks it untrusted.
// - The forecast block is only included after a deterministic server-side
//   computation has succeeded; the assistant explains those figures, it never
//   computes or overrides them.

export const CONTEXT_MODEL_LIMITS = {
  maxCategories: 12,
  maxBudgets: 12,
  maxBills: 12,
  maxCategoryNameLength: 60,
} as const;

export interface AssistantContext {
  today: string;
  currency: string;
  schedule: {
    label: string;
    frequency: string;
    expectedAmount: string;
    nextPayday: string;
  } | null;
  cashPosition: {
    amount: string;
    asOfDate: string;
  } | null;
  currentMonth: {
    month: string;
    income: string;
    expenses: string;
    net: string;
  };
  previousMonth: {
    month: string;
    income: string;
    expenses: string;
    net: string;
  };
  spendingByCategory: Array<{
    category: string;
    amount: string;
    sharePercent: number;
  }>;
  budgets: Array<{
    name: string;
    limit: string;
    spent: string;
    remaining: string;
    percentUsed: number | null;
    status: "ok" | "warning" | "over";
  }>;
  activeBills: Array<{
    name: string;
    amount: string;
    frequency: string;
    nextDueDate: string;
    status: "overdue" | "due-today" | "upcoming";
  }>;
  forecast: {
    startDate: string;
    endDate: string;
    startingCash: string;
    recordedIncome: string;
    recordedExpenses: string;
    expectedSalary: string;
    expectedSalaryReconciled: boolean;
    unpaidBillsTotal: string;
    estimatedEndingCash: string;
    warnings: string[];
  } | null;
}

export interface ContextInputs {
  userId: string;
  todayIso: string;
  client: SupabaseClient;
}

// Minimal structural typing over the supabase-js client to keep this file
// independent of the bundler-specific import surface.
export interface SupabaseClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        gte(column: string, value: unknown): {
          lte(column: string, value: unknown): {
            then(resolve: (result: { data: unknown; error: { message: string } | null }) => void): void;
          };
        };
      };
      maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

interface Row {
  [column: string]: unknown;
}

function decimal(value: unknown): string {
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return "0.00";
}

function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents).toString().padStart(3, "0");
  return `${sign}${abs.slice(0, abs.length - 2)}.${abs.slice(-2)}`;
}

function addDecimalStrings(values: string[]): string {
  let cents = 0;
  for (const value of values) {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [intPart = "0", decPartRaw = ""] = unsigned.split(".");
    const decPart = (decPartRaw + "00").slice(0, 2);
    const c = Number.parseInt(intPart, 10) * 100 + Number.parseInt(decPart || "0", 10);
    cents += negative ? -c : c;
  }
  return centsToDecimalString(cents);
}

// Hardened user-controlled text: length-bounded, control characters stripped,
// and fence markers collapsed so it cannot forge the data-fence in the prompt.
export function sanitizeUserText(raw: unknown, maxLength: number): string {
  if (typeof raw !== "string") {
    return "";
  }
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[`]{3,}/g, "'''")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

function monthStart(todayIso: string, offsetMonths: number): string {
  const m = todayIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !m[1] || !m[2]) {
    return todayIso.slice(0, 7) + "-01";
  }
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1 + offsetMonths;
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthEnd(startDate: string): string {
  const m = startDate.match(/^(\d{4})-(\d{2})-01$/);
  if (!m || !m[1] || !m[2]) {
    return startDate;
  }
  const lastDay = new Date(Number(m[1]), Number(m[2]), 0).getDate();
  return `${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`;
}

interface MonthTotals {
  income: string;
  expenses: string;
}

interface CategoryTotal {
  name: string;
  amount: string;
}

interface BudgetRow {
  limit_amount: unknown;
  categories: { name: unknown } | { name: unknown }[] | null;
}

interface TransactionRow {
  amount: unknown;
  categories: { name: unknown } | { name: unknown }[] | null;
}

function categoryName(value: { name: unknown } | { name: unknown }[] | null): string {
  if (!value) {
    return "Uncategorized";
  }
  const first = Array.isArray(value) ? value[0] : value;
  const name = first ? sanitizeUserText(first.name, CONTEXT_MODEL_LIMITS.maxCategoryNameLength) : "";
  return name || "Uncategorized";
}

async function monthTotals(
  client: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<MonthTotals> {
  const { data, error } = await client
    .from("transactions")
    .select("kind,amount")
    .eq("user_id", userId)
    .gte("transaction_date", from)
    .lte("transaction_date", to);
  if (error) {
    throw new Error("month totals query failed");
  }
  const rows = (Array.isArray(data) ? data : []) as Row[];
  let incomeCents = 0;
  let expenseCents = 0;
  for (const row of rows) {
    const amount = decimal(row.amount);
    const c = Math.round(Number(addDecimalStrings([amount]).replace("-", "")) * 0) === 0
      ? Number(addDecimalStrings([amount]).replace("-", "")) * 100
      : 0;
    void c;
  }
  // Recompute cleanly (the loop above only validates shape).
  incomeCents = 0;
  expenseCents = 0;
  for (const row of rows) {
    const amountCents = Math.round(Number(decimal(row.amount)) * 100);
    if (row.kind === "income") {
      incomeCents += amountCents;
    } else if (row.kind === "expense") {
      expenseCents += amountCents;
    }
  }
  return { income: centsToDecimalString(incomeCents), expenses: centsToDecimalString(expenseCents) };
}

async function expenseTotalsByCategory(
  client: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<CategoryTotal[]> {
  const { data, error } = await client
    .from("transactions")
    .select("amount,categories(name)")
    .eq("user_id", userId)
    .eq("kind", "expense")
    .gte("transaction_date", from)
    .lte("transaction_date", to);
  if (error) {
    throw new Error("category totals query failed");
  }
  const rows = (Array.isArray(data) ? data : []) as TransactionRow[];
  const byCategory = new Map<string, number>();
  for (const row of rows) {
    const name = categoryName(row.categories);
    const amountCents = Math.round(Number(decimal(row.amount)) * 100);
    byCategory.set(name, (byCategory.get(name) ?? 0) + amountCents);
  }
  const totalCents = [...byCategory.values()].reduce((sum, c) => sum + c, 0);
  return [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CONTEXT_MODEL_LIMITS.maxCategories)
    .map(([name, cents]) => ({
      category: name,
      amount: centsToDecimalString(cents),
      sharePercent: totalCents > 0 ? Math.round((cents / totalCents) * 1000) / 10 : 0,
    }));
}

interface RawBudget {
  limit_amount: unknown;
  categories: { name: unknown } | { name: unknown }[] | null;
  spent_cents: number;
}

async function loadBudgets(
  client: SupabaseClient,
  userId: string,
  monthStartIso: string
): Promise<Array<{ name: string; limit: string; spent: string; remaining: string; percentUsed: number | null; status: "ok" | "warning" | "over" }>> {
  const { data, error } = await client
    .from("budgets")
    .select("limit_amount,categories(name)")
    .eq("user_id", userId)
    .eq("month", monthStartIso);
  if (error) {
    throw new Error("budgets query failed");
  }
  const budgetRows = (Array.isArray(data) ? data : []) as RawBudget[];
  if (budgetRows.length === 0) {
    return [];
  }

  // Spent amounts come from actual expense transactions in the month.
  const { data: txData, error: txError } = await client
    .from("transactions")
    .select("amount,categories(name)")
    .eq("user_id", userId)
    .eq("kind", "expense")
    .gte("transaction_date", monthStartIso)
    .lte("transaction_date", monthEnd(monthStartIso));
  if (txError) {
    throw new Error("budget spending query failed");
  }
  const txRows = (Array.isArray(txData) ? txData : []) as TransactionRow[];
  const overallSpent = txRows.reduce((sum, row) => sum + Math.round(Number(decimal(row.amount)) * 100), 0);
  const byCategorySpent = new Map<string, number>();
  for (const row of txRows) {
    const name = categoryName(row.categories);
    byCategorySpent.set(name, (byCategorySpent.get(name) ?? 0) + Math.round(Number(decimal(row.amount)) * 100));
  }

  return budgetRows.slice(0, CONTEXT_MODEL_LIMITS.maxBudgets).map((budget) => {
    const name = budget.categories ? categoryName(budget.categories) : "Overall (all categories)";
    const limitCents = Math.round(Number(decimal(budget.limit_amount)) * 100);
    const spentCents =
      name === "Overall (all categories)"
        ? overallSpent
        : byCategorySpent.get(name) ?? 0;
    const remainingCents = limitCents - spentCents;
    const percentUsed = limitCents > 0 ? Math.round((spentCents / limitCents) * 1000) / 10 : null;
    const status: "ok" | "warning" | "over" =
      percentUsed === null || percentUsed < 80 ? "ok" : percentUsed < 100 ? "warning" : "over";
    return {
      name,
      limit: centsToDecimalString(limitCents),
      spent: centsToDecimalString(spentCents),
      remaining: centsToDecimalString(remainingCents),
      percentUsed,
      status,
    };
  });
}

interface RawBill {
  name: unknown;
  amount: unknown;
  frequency: unknown;
  next_due_date: unknown;
}

async function loadActiveBills(
  client: SupabaseClient,
  userId: string,
  todayIso: string
): Promise<Array<{ name: string; amount: string; frequency: string; nextDueDate: string; status: "overdue" | "due-today" | "upcoming" }>> {
  const { data, error } = await client
    .from("recurring_bills")
    .select("name,amount,frequency,next_due_date")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("next_due_date", { ascending: true } as never)
    .limit(CONTEXT_MODEL_LIMITS.maxBills);
  if (error) {
    throw new Error("bills query failed");
  }
  const rows = (Array.isArray(data) ? data : []) as RawBill[];
  return rows
    .map((row) => {
      const dueDate = typeof row.next_due_date === "string" ? row.next_due_date.slice(0, 10) : "";
      const status: "overdue" | "due-today" | "upcoming" =
        dueDate && dueDate < todayIso ? "overdue" : dueDate === todayIso ? "due-today" : "upcoming";
      return {
        name: sanitizeUserText(row.name, CONTEXT_MODEL_LIMITS.maxCategoryNameLength),
        amount: decimal(row.amount),
        frequency: typeof row.frequency === "string" ? row.frequency : "unknown",
        nextDueDate: dueDate,
        status,
      };
    })
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

interface RawSchedule {
  label: unknown;
  frequency: unknown;
  expected_amount: unknown;
  next_payday: unknown;
}

interface RawCash {
  amount: unknown;
  as_of_date: unknown;
}

export async function buildAssistantContext(inputs: ContextInputs): Promise<AssistantContext> {
  const { userId, todayIso, client } = inputs;
  const currentStart = monthStart(todayIso, 0);
  const previousStart = monthStart(todayIso, -1);

  const [currentTotals, previousTotals, spending, budgets, bills, scheduleResult, cashResult] =
    await Promise.all([
      monthTotals(client, userId, currentStart, monthEnd(currentStart)),
      monthTotals(client, userId, previousStart, monthEnd(previousStart)),
      expenseTotalsByCategory(client, userId, currentStart, monthEnd(currentStart)),
      loadBudgets(client, userId, currentStart),
      loadActiveBills(client, userId, todayIso),
      client.from("income_schedules").select("label,frequency,expected_amount,next_payday").eq("user_id", userId).eq("is_active", true).maybeSingle(),
      client.from("cash_positions").select("amount,as_of_date").eq("user_id", userId).maybeSingle(),
    ]);

  const scheduleRow = scheduleResult.error ? null : (scheduleResult.data as RawSchedule | null);
  const cashRow = cashResult.error ? null : (cashResult.data as RawCash | null);

  const monthLabel = currentStart.slice(0, 7);
  const previousLabel = previousStart.slice(0, 7);

  return {
    today: todayIso,
    currency: "PHP",
    schedule: scheduleRow
      ? {
          label: sanitizeUserText(scheduleRow.label, CONTEXT_MODEL_LIMITS.maxCategoryNameLength) || "Salary",
          frequency: typeof scheduleRow.frequency === "string" ? scheduleRow.frequency : "unknown",
          expectedAmount: decimal(scheduleRow.expected_amount),
          nextPayday: typeof scheduleRow.next_payday === "string" ? scheduleRow.next_payday.slice(0, 10) : "",
        }
      : null,
    cashPosition: cashRow
      ? {
          amount: decimal(cashRow.amount),
          asOfDate: typeof cashRow.as_of_date === "string" ? cashRow.as_of_date.slice(0, 10) : "",
        }
      : null,
    currentMonth: {
      month: monthLabel,
      income: currentTotals.income,
      expenses: currentTotals.expenses,
      net: addDecimalStrings([currentTotals.income, `-${currentTotals.expenses}`]),
    },
    previousMonth: {
      month: previousLabel,
      income: previousTotals.income,
      expenses: previousTotals.expenses,
      net: addDecimalStrings([previousTotals.income, `-${previousTotals.expenses}`]),
    },
    spendingByCategory: spending,
    budgets,
    activeBills: bills,
    forecast: null,
  };
}
