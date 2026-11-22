export type SalaryFrequency = "monthly" | "biweekly";

export interface Profile {
  id: string;
  display_name: string | null;
  preferred_currency: string;
  timezone: string;
}

export interface IncomeSchedule {
  id: string;
  user_id: string;
  label: string;
  expected_amount: string;
  frequency: SalaryFrequency;
  next_payday: string;
  is_active: boolean;
}

export interface CashPosition {
  id: string;
  user_id: string;
  amount: string;
  as_of_date: string;
}

export function isValidCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

export type TransactionKind = "income" | "expense";

export interface Category {
  id: string;
  name: string;
  kind: TransactionKind;
  is_system: boolean;
}

export interface TransactionRow {
  id: string;
  kind: TransactionKind;
  amount: string;
  transaction_date: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  created_at: string;
}

export interface Summary {
  income: string;
  expense: string;
  net: string;
}

export function isTransactionKind(value: string): value is TransactionKind {
  return value === "income" || value === "expense";
}

// Shared comma-grouping rules for amount inputs:
// - "1,250.00" (thousands grouping, comma followed by exactly 3 digits) is accepted.
// - "12,50.00" (comma NOT followed by exactly 3 digits) is REJECTED, never
//   silently reinterpreted — a comma-as-decimal typo must not become 1250.00.
function hasValidCommaGrouping(trimmed: string): boolean {
  const commas = trimmed.match(/,/g);
  if (!commas) return true;
  return /^-?\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(trimmed);
}

// Validates a user-entered amount and returns an exact decimal string
// (never a JS number) for persistence into numeric(14,2).
export function parseAmountToDecimalString(raw: string): string | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!hasValidCommaGrouping(raw.trim()) || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [intPart, decPart] = trimmed.split(".");
  if (!intPart || intPart.length > 12) {
    return null;
  }
  const isZero = /^0+(\.0{1,2})?$/.test(trimmed);
  if (isZero) {
    return null;
  }
  const intNorm = intPart.replace(/^0+(?=\d)/, "");
  const decNorm = (decPart ?? "").padEnd(2, "0").slice(0, 2);
  return `${intNorm}.${decNorm}`;
}

// Accepts YYYY-MM-DD or M/D/YYYY and returns a validated ISO date string.
export function normalizeDateInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isValidDate(trimmed) ? trimmed : null;
  }
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m && m[1] && m[2] && m[3]) {
    const iso = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return isValidDate(iso) ? iso : null;
  }
  return null;
}

// Month helpers: "YYYY-MM" plus its first/last day, clamped for short months.
export function monthRange(ym: string): { start: string; end: string } {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m || !m[1] || !m[2]) {
    return { start: "", end: "" };
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function getMonthMeta(base: Date = new Date()): { ym: string; label: string } {
  const ym = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
  const label = base.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  return { ym, label };
}

// Sums decimal strings exactly using cent arithmetic (no binary floats).
export function sumAmounts(rows: Array<{ amount: string | number }>): string {
  let cents = 0n;
  for (const row of rows) {
    cents += amountToCents(row.amount);
  }
  return centsToDecimalString(cents);
}

// Adds signed amounts: positive strings add, "-x" strings subtract.
export function addSignedAmounts(amounts: Array<string | number>): string {
  let cents = 0n;
  for (const amount of amounts) {
    cents += amountToCents(amount);
  }
  return centsToDecimalString(cents);
}

// Difference of two decimal strings, exact (a - b).
export function diffAmounts(a: string | number, b: string | number): string {
  return centsToDecimalString(amountToCents(a) - amountToCents(b));
}

// PostgREST returns numeric columns as JSON numbers; accept both shapes so
// string-based cent math never breaks on a raw number from the database.
export function amountToCents(amount: string | number): bigint {
  if (typeof amount === "number") {
    amount = amount.toString();
  }
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [intPart, decPart] = unsigned.split(".");
  const int = intPart === undefined || intPart === "" ? "0" : intPart;
  const dec = ((decPart ?? "") + "00").slice(0, 2);
  const cents = BigInt(int) * 100n + BigInt(dec === "" ? "0" : dec);
  return negative ? -cents : cents;
}

export function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = (negative ? -cents : cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${abs.slice(0, abs.length - 2)}.${abs.slice(-2)}`;
}

export function parsePositiveAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!hasValidCommaGrouping(raw.trim()) || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

export function parseNonNegativeAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!hasValidCommaGrouping(raw.trim()) || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

// Exact decimal string for amounts that may be zero (cash position allows 0),
// mirroring parseAmountToDecimalString without its zero rejection.
export function parseNonNegativeDecimalString(raw: string): string | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!hasValidCommaGrouping(raw.trim()) || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [intPart, decPart] = trimmed.split(".");
  if (!intPart || intPart.length > 12) {
    return null;
  }
  const intNorm = intPart.replace(/^0+(?=\d)/, "");
  const decNorm = (decPart ?? "").padEnd(2, "0").slice(0, 2);
  return `${intNorm}.${decNorm}`;
}

export function isValidDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return false;
  }
  const parsed = new Date(`${raw}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

export function formatCurrency(amount: string | number, currency: string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
