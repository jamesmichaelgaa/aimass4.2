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

export function parsePositiveAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
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
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
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
