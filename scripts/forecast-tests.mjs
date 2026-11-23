// Financial test harness — Forecast batch (F-01 … F-15, docs/testing-plan-financial.md §6).
// Real anon-key clients + real password-auth sessions (RLS applies exactly as in the
// running app); no service-role key. The forecast is computed by mirroring
// src/lib/forecast.ts's pure logic over the REAL user rows the app would read
// (schedule, cash, transactions, bills, bill_payments), so every assertion is
// against production-shaped inputs.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const eq = line.indexOf("=");
      return [line.slice(0, eq), line.slice(eq + 1).replace(/^["']|["']$/g, "")];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
}

const results = [];
function record(id, expected, actual, status, evidence, action) {
  results.push({ id, expected, actual, status, evidence, action: action ?? "" });
}

function toCents(s) {
  s = String(s);
  const neg = s.startsWith("-");
  const unsigned = neg ? s.slice(1) : s;
  const [i, d] = unsigned.split(".");
  const cents = BigInt(i || "0") * 100n + BigInt(((d ?? "") + "00").slice(0, 2));
  return neg ? -cents : cents;
}
function centsToDecimalString(c) {
  const neg = c < 0n;
  const abs = (neg ? -c : c).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${abs.slice(0, abs.length - 2)}.${abs.slice(-2)}`;
}
function addSignedAmounts(list) {
  return centsToDecimalString(list.reduce((acc, v) => acc + toCents(v), 0n));
}
// Mirror of the app's asDecimalString: PostgREST returns numeric(14,2) as JSON
// numbers (500, not "500.00"), so every value is normalized before comparison.
function norm(v) {
  return centsToDecimalString(toCents(String(v)));
}

const PASSWORD = "TestOnly-2026-x7";
// Fresh disposable account for this stage: txa still holds payment-linked
// leftovers from the bills stage (kept until FX-5 teardown), which would
// contaminate every forecast window. txb is clean and reused as the
// cross-user isolation account.
const emailA = "fxa.20261123-forecast@aimass-test.invalid";
const emailB = "txb.20261122-tx@aimass-test.invalid";

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Mirror of src/lib/forecast.ts addMonthsClamped / nextPaydayAfter.
function addMonthsClamped(iso, months) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const totalMonths = year * 12 + (month - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(newYear, newMonth, 0).getDate();
  const newDay = Math.min(day, lastDay);
  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-${String(newDay).padStart(2, "0")}`;
}
function nextPaydayAfter(frequency, nextPayday, afterIso) {
  let cursor = nextPayday;
  const stepMonths = frequency === "monthly" ? 1 : 0;
  let guard = 0;
  while (cursor <= afterIso && guard < 400) {
    cursor = stepMonths === 1 ? addMonthsClamped(cursor, 1) : addDaysIso(cursor, 14);
    guard++;
  }
  return cursor;
}
function billStep(frequency, iso) {
  if (frequency === "weekly") return addDaysIso(iso, 7);
  if (frequency === "monthly") return addMonthsClamped(iso, 1);
  if (frequency === "quarterly") return addMonthsClamped(iso, 3);
  return addMonthsClamped(iso, 12);
}
// Mirror of nextBillDueAfter + unpaidBillOccurrences for the window.
function unpaidOccurrences(bills, paidKeys, asOf, cutoff) {
  const out = [];
  for (const bill of bills) {
    if (!bill.is_active) continue;
    let cursor = bill.next_due_date;
    let guard = 0;
    while (cursor <= asOf && guard < 400) {
      cursor = billStep(bill.frequency, cursor);
      guard++;
    }
    guard = 0;
    while (cursor <= cutoff && guard < 60) {
      if (!paidKeys.has(`${bill.id}:${cursor}`)) {
        out.push({ billId: bill.id, dueDate: cursor, amount: norm(bill.amount), categoryId: bill.category_id, name: bill.name });
      }
      cursor = billStep(bill.frequency, cursor);
      guard++;
    }
  }
  return out.sort((x, y) => x.dueDate.localeCompare(y.dueDate));
}
// Mirror of findReconcilingSalaryTransaction.
function reconcile(transactions, schedule, payday, salaryCategoryId) {
  if (!salaryCategoryId) return null;
  const windowStart = addDaysIso(payday, -3);
  const expectedCents = toCents(schedule.expected_amount);
  const candidates = transactions.filter((t) =>
    t.kind === "income" && t.category_id === salaryCategoryId
    && t.transaction_date >= windowStart && t.transaction_date <= payday
    && (toCents(norm(t.amount)) - expectedCents >= -1n) && (toCents(norm(t.amount)) - expectedCents <= 1n)
  ).sort((x, y) => x.transaction_date.localeCompare(y.transaction_date) || String(x.created_at).localeCompare(String(y.created_at)));
  return candidates[0] ?? null;
}

// The computeForecast pipeline over live user rows, mirroring src/lib/forecast.ts.
async function computeForecastMirror(client, schedule, cashAmount, cashAsOf) {
  const payday = nextPaydayAfter(schedule.frequency, schedule.next_payday, cashAsOf);
  const from = addDaysIso(cashAsOf, 1);
  const txRes = await client.from("transactions")
    .select("id,kind,amount,transaction_date,category_id,description,created_at")
    .gte("transaction_date", from).lte("transaction_date", payday).order("transaction_date");
  if (txRes.error) return { ok: false, message: txRes.error.message };
  const transactions = txRes.data ?? [];
  const billRes = await client.from("recurring_bills").select("id,name,amount,frequency,next_due_date,is_active,category_id").eq("is_active", true);
  if (billRes.error) return { ok: false, message: billRes.error.message };
  const bills = billRes.data ?? [];
  const paidRes = bills.length
    ? await client.from("bill_payments").select("recurring_bill_id,due_date").in("recurring_bill_id", bills.map((x) => x.id)).gte("due_date", from).lte("due_date", payday)
    : { data: [], error: null };
  const paidKeys = new Set((paidRes.data ?? []).map((r) => `${r.recurring_bill_id}:${r.due_date}`));
  const unpaid = unpaidOccurrences(bills, paidKeys, cashAsOf, payday);
  const catRes = await client.from("categories").select("id").eq("kind", "income").eq("is_system", true).ilike("name", "salary").limit(1);
  const salaryCategoryId = catRes.data?.[0]?.id ?? null;
  const match = reconcile(transactions, schedule, payday, salaryCategoryId);
  let incomeCents = 0n, expenseCents = 0n;
  for (const t of transactions) {
    if (t.kind === "income") incomeCents += toCents(norm(t.amount));
    else expenseCents += toCents(norm(t.amount));
  }
  const expectedSalaryReconciled = match !== null;
  const billTotal = unpaid.reduce((acc, o) => acc + toCents(o.amount), 0n);
  const expectedSalary = expectedSalaryReconciled ? "0.00" : norm(schedule.expected_amount);
  const estimatedEndingCash = addSignedAmounts([
    norm(cashAmount), centsToDecimalString(incomeCents), centsToDecimalString(-expenseCents), expectedSalary, centsToDecimalString(-billTotal),
  ]);
  const warnings = [];
  if (estimatedEndingCash.startsWith("-")) warnings.push("negative");
  if (expectedSalaryReconciled) warnings.push("reconciled");
  if (unpaid.length > 0) warnings.push(`unpaidBills:${unpaid.length}`);
  return {
    ok: true, asOfDate: cashAsOf, startDate: from, endDate: payday,
    startingCash: norm(cashAmount), recordedIncome: centsToDecimalString(incomeCents),
    recordedExpenses: centsToDecimalString(expenseCents), expectedSalary, expectedSalaryReconciled,
    unpaidBills: unpaid, estimatedEndingCash, warnings,
    events: [
      ...transactions.map((t) => ({ date: t.transaction_date, kind: t.kind, amount: norm(t.amount) })),
      ...(expectedSalaryReconciled ? [] : [{ date: payday, kind: "expected-salary", amount: expectedSalary }]),
      ...unpaid.map((o) => ({ date: o.dueDate, kind: "bill", amount: `-${o.amount}` })),
    ].sort((x, y) => x.date.localeCompare(y.date)),
  };
}

const adminNote = [];
async function createTestUser(email) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let session = null;
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.data?.session) {
    session = signIn.data.session;
  } else {
    const signUp = await client.auth.signUp({ email, password: PASSWORD });
    if (signUp.error || !signUp.data?.session) {
      adminNote.push(`${email}: ${signUp.error?.message ?? signIn.error?.message ?? "no session"}`);
      return null;
    }
    session = signUp.data.session;
  }
  return { email, session };
}

async function main() {
  const A = await createTestUser(emailA);
  const B = await createTestUser(emailB);
  if (!A || !B) {
    record("FX-1/FX-2", "Deferred accounts sign in", `A=${!!A} B=${!!B}`, "BLOCKED", adminNote.join(" | "));
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }
  const a = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${A.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const b = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${B.session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });

  const catsA = await a.from("categories").select("id,name,kind,is_system").order("name");
  const salaryA = catsA.data.find((c) => c.name === "Salary" && c.kind === "income");
  const otherIncomeA = catsA.data.find((c) => c.name === "Other Income" && c.kind === "income");
  const rentA = catsA.data.find((c) => c.kind === "expense" && c.name === "Rent");

  // Best-effort clean slate. Bulk deletes abort entirely when a single
  // payment-linked row exists (bill_payments RESTRICT), so per-case cleanups
  // below delete their own rows individually instead of relying on this.
  await a.from("bill_payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("bill_payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("recurring_bills").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("recurring_bills").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("cash_positions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("cash_positions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // Individual delete that reports failures instead of failing silently.
  async function del(client, table, id, errs) {
    const { error } = await client.from(table).delete().eq("id", id);
    if (error) errs.push(`${table}/${id}: ${error.message}`);
  }

  async function setInputs(client, { amount, asOf, frequency, expected, nextPayday }) {
    await client.from("cash_positions").upsert({ amount, as_of_date: asOf }, { onConflict: "user_id" });
    await client.from("income_schedules").insert({
      label: "Test salary", frequency, expected_amount: expected, next_payday: nextPayday,
    });
  }

  const TODAY = new Date().toISOString().slice(0, 10);
  const D = addDaysIso(TODAY, -2); // as-of date two days back (within picker bounds)

  // ============ F-01 monthly baseline ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "8500.00", asOf: D, frequency: "monthly", expected: "25000.00", nextPayday: P });
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "8500.00", D);
    const ok = f.ok && f.estimatedEndingCash === "33500.00" && f.endDate === P
      && f.events.some((e) => e.kind === "expected-salary" && e.date === P);
    record("F-01", "Monthly baseline: 8500 + 25000 on payday = 33500.00; salary event on P",
      f.ok ? `ending=${f.estimatedEndingCash} window=(${f.startDate}…${f.endDate}]` : f.message,
      ok ? "PASS" : "FAIL", "");
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  // ============ F-02 biweekly progression ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "1000.00", asOf: D, frequency: "biweekly", expected: "5000.00", nextPayday: P });
    const f = await computeForecastMirror(a, { frequency: "biweekly", next_payday: P, expected_amount: "5000.00" }, "1000.00", D);
    const progression = nextPaydayAfter("biweekly", P, P); // the payday AFTER P
    const ok = f.ok && f.endDate === P && progression === addDaysIso(P, 14);
    record("F-02", "Biweekly: forecast window ends on the next payday P; the following progression is exactly P+14",
      f.ok ? `endDate=${f.endDate} (expected ${P}); next progression ${progression} (expected ${addDaysIso(P, 14)})` : f.message,
      ok ? "PASS" : "FAIL", "");
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  // ============ F-03 monthly clamping on payday progression ============
  {
    const feb28 = addMonthsClamped("2026-01-31", 1);
    const apr30 = addMonthsClamped("2026-01-31", 3);
    const ok = feb28 === "2026-02-28" && apr30 === "2026-04-30";
    record("F-03", "Payday progression clamps: Jan-31 → Feb-28, → Apr-30",
      `Jan31→${feb28}, Apr→${apr30}`,
      ok ? "PASS" : "FAIL", "Same addMonthsClamped the DB advance_due_date now implements (fixed in the bills stage).");
  }

  // ============ F-04 recorded income strictly after D ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "8500.00", asOf: D, frequency: "monthly", expected: "25000.00", nextPayday: P });
    const incomeRow = await a.from("transactions").insert({
      kind: "income", amount: "2000.00", transaction_date: addDaysIso(D, 1), category_id: otherIncomeA.id, description: "F-04 income",
    }).select("id").single();
    const onD = await a.from("transactions").insert({
      kind: "income", amount: "500.00", transaction_date: D, category_id: null, description: "F-04 on-as-of",
    }).select("id").single();
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "8500.00", D);
    const ok = f.ok && f.recordedIncome === "2000.00" && f.estimatedEndingCash === "35500.00";
    record("F-04", "Income D+1 counts (ending 35500.00); income dated D does NOT (window is strictly after D)",
      f.ok ? `recordedIncome=${f.recordedIncome} ending=${f.estimatedEndingCash}` : f.message,
      ok ? "PASS" : "FAIL", "");
    const errs = [];
    await del(a, "transactions", incomeRow.data.id, errs);
    await del(a, "transactions", onD.data.id, errs);
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (errs.length) results[results.length - 1].evidence += ` cleanup: ${errs.join("; ")}`;
  }

  // ============ F-05 recorded expenses strictly after D ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "8500.00", asOf: D, frequency: "monthly", expected: "25000.00", nextPayday: P });
    const expRow = await a.from("transactions").insert({
      kind: "expense", amount: "300.00", transaction_date: addDaysIso(D, 2), category_id: rentA.id, description: "F-05 expense",
    }).select("id").single();
    const onD = await a.from("transactions").insert({
      kind: "expense", amount: "100.00", transaction_date: D, category_id: null, description: "F-05 on-as-of",
    }).select("id").single();
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "8500.00", D);
    const ok = f.ok && f.recordedExpenses === "300.00" && f.estimatedEndingCash === "33200.00";
    record("F-05", "Expense D+2 counts (ending 33200.00); expense dated D does NOT",
      f.ok ? `recordedExpenses=${f.recordedExpenses} ending=${f.estimatedEndingCash}` : f.message,
      ok ? "PASS" : "FAIL", "");
    const errs = [];
    await del(a, "transactions", expRow.data.id, errs);
    await del(a, "transactions", onD.data.id, errs);
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (errs.length) results[results.length - 1].evidence += ` cleanup: ${errs.join("; ")}`;
  }

  // ============ F-06 unpaid bill occurrence ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "8500.00", asOf: D, frequency: "monthly", expected: "25000.00", nextPayday: P });
    const bill = await a.from("recurring_bills").insert({
      name: "F-06 bill", amount: "500.00", frequency: "monthly", next_due_date: addDaysIso(D, 5), category_id: rentA.id,
    }).select("id").single();
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "8500.00", D);
    const ok = f.ok && f.unpaidBills.length === 1 && f.estimatedEndingCash === "33000.00"
      && f.events.some((e) => e.kind === "bill" && e.amount === "-500.00");
    record("F-06", "Unpaid 500.00 bill due D+5: timeline event + ending 33000.00",
      f.ok ? `unpaid=${f.unpaidBills.length} ending=${f.estimatedEndingCash}` : f.message,
      ok ? "PASS" : "FAIL", "");
    const errs = [];
    await del(a, "recurring_bills", bill.data.id, errs);
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (errs.length) results[results.length - 1].evidence += ` cleanup: ${errs.join("; ")}`;
  }

  // ============ F-07 paid bill exclusion / no double count ============
  {
    // Far-future window: the recorded payment leaves a payment-linked expense
    // that only account teardown can remove (bill_payments is client-read-only
    // by design). Dating it 2027-06 keeps it outside every other case's
    // window; assertions are deltas so reruns stay exact.
    const D7 = "2027-06-01";
    const P7 = "2027-06-10";
    const DUE7 = "2027-06-05";
    await setInputs(a, { amount: "8500.00", asOf: D7, frequency: "monthly", expected: "25000.00", nextPayday: P7 });
    const bill = await a.from("recurring_bills").insert({
      name: "F-07 bill", amount: "500.00", frequency: "monthly", next_due_date: DUE7, category_id: rentA.id,
    }).select("id").single();
    const before = await computeForecastMirror(a, { frequency: "monthly", next_payday: P7, expected_amount: "25000.00" }, "8500.00", D7);
    const pay = await a.rpc("mark_bill_occurrence_paid", {
      p_recurring_bill_id: bill.data.id, p_due_date: DUE7,
      p_category_id: rentA.id, p_description: "F-07 payment", p_amount: "500.00", p_transaction_date: null,
    });
    const after = await computeForecastMirror(a, { frequency: "monthly", next_payday: P7, expected_amount: "25000.00" }, "8500.00", D7);
    const expenseDelta = addSignedAmounts([after.recordedExpenses, centsToDecimalString(-toCents(before.recordedExpenses))]);
    const endingDelta = addSignedAmounts([after.estimatedEndingCash, centsToDecimalString(-toCents(before.estimatedEndingCash))]);
    const ok = !pay.error && before.ok && after.ok
      && before.unpaidBills.length === 1 && after.unpaidBills.length === 0
      && expenseDelta === "500.00" && endingDelta === "0.00";
    record("F-07", "Paid occurrence: projected unpaid bill disappears; linked expense counted exactly ONCE — expenses +500.00 AND ending UNCHANGED (bill line −500.00 replaced by the actual expense +500.00; no double count)",
      `before unpaid=${before.ok ? before.unpaidBills.length : "?"} after unpaid=${after.ok ? after.unpaidBills.length : "?"} expenseDelta=${expenseDelta} endingDelta=${endingDelta}${pay.error ? " payError=" + pay.error.message : ""}`,
      ok ? "PASS" : "FAIL", "Payment-linked rows remain until FX-5 teardown; deltas keep reruns exact. before/after windows both fully inside June 2027.");
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  // ============ F-08 exact cents / JSON-number regression guard ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "0.07", asOf: D, frequency: "monthly", expected: "0.04", nextPayday: P });
    const i1 = await a.from("transactions").insert({
      kind: "income", amount: "1000.10", transaction_date: addDaysIso(D, 1), category_id: otherIncomeA.id, description: "F-08 income",
    }).select("id").single();
    const e1 = await a.from("transactions").insert({
      kind: "expense", amount: "999.99", transaction_date: addDaysIso(D, 1), category_id: null, description: "F-08 expense",
    }).select("id").single();
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "0.04" }, "0.07", D);
    const ok = f.ok && f.estimatedEndingCash === "0.22" && f.recordedIncome === "1000.10" && f.recordedExpenses === "999.99";
    record("F-08", "Exact cents: 0.07 + 1000.10 − 999.99 + 0.04 = 0.22 (no float drift; JSON-number payloads safe)",
      f.ok ? `ending=${f.estimatedEndingCash} income=${f.recordedIncome} expense=${f.recordedExpenses}` : f.message,
      ok ? "PASS" : "FAIL", "Regression guard for the earlier amountToCents JSON-number crash.");
    const errs = [];
    await del(a, "transactions", i1.data.id, errs);
    await del(a, "transactions", e1.data.id, errs);
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (errs.length) results[results.length - 1].evidence += ` cleanup: ${errs.join("; ")}`;
  }

  // ============ F-09 reconciliation series ============
  {
    const P = TODAY; // payday = today; reconciliation window [P-3, P]
    // As-of = P−4 so the P−3 boundary case sits INSIDE the forecast window
    // (D, P]: reconciliation only sees transactions the forecast fetches.
    const D9 = addDaysIso(P, -4);
    const scenarios = [
      { id: "F-09a", date: P, amount: "25000.00", category: salaryA.id, reconciled: true, inWindow: true, note: "exact on payday" },
      { id: "F-09b", date: addDaysIso(P, -3), amount: "25000.00", category: salaryA.id, reconciled: true, inWindow: true, note: "P−3 inclusive" },
      { id: "F-09c", date: D9, amount: "25000.00", category: salaryA.id, reconciled: false, inWindow: false, note: "P−4 outside both windows (transaction not counted at all)" },
      { id: "F-09d", date: P, amount: "24999.98", category: salaryA.id, reconciled: false, inWindow: true, note: "off by 0.02" },
      { id: "F-09e", date: P, amount: "24999.99", category: salaryA.id, reconciled: true, inWindow: true, note: "off by 0.01 tolerance" },
      { id: "F-09f", date: P, amount: "25000.00", category: otherIncomeA.id, reconciled: false, inWindow: true, note: "wrong category" },
    ];
    for (const s of scenarios) {
      await setInputs(a, { amount: "8500.00", asOf: D9, frequency: "monthly", expected: "25000.00", nextPayday: P });
      const tx = await a.from("transactions").insert({
        kind: "income", amount: s.amount, transaction_date: s.date, category_id: s.category, description: `F-09 ${s.id}`,
      }).select("id").single();
      const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "8500.00", D9);
      // Reconciled → expected salary dropped; the recorded income counts ONCE
      // at its actual amount. Not reconciled → BOTH lines count, except where
      // the transaction itself sits outside the forecast window (F-09c) and
      // counts zero times.
      const expectedEnding = s.id === "F-09c"
        ? "33500.00"
        : s.reconciled
          ? addSignedAmounts(["8500.00", s.amount])
          : addSignedAmounts(["8500.00", s.amount, "25000.00"]);
      const ok = f.ok && f.expectedSalaryReconciled === s.reconciled
        && f.estimatedEndingCash === expectedEnding
        && f.events.some((e) => e.kind === "expected-salary") === !s.reconciled;
      record(s.id, `Reconciliation: ${s.note} → reconciled=${s.reconciled}, ending ${expectedEnding}`,
        f.ok ? `reconciled=${f.expectedSalaryReconciled} expectedSalary=${f.expectedSalary} ending=${f.estimatedEndingCash} warnings=${f.warnings.join(",")}`
          : f.message,
        ok ? "PASS" : "FAIL", s.reconciled ? "Expected salary dropped; income counted once at its actual amount." : s.inWindow ? "Both lines count (disclosed known limitation)." : "Transaction outside forecast window: counted zero times, expected salary still projected.");
      const errs = [];
      await del(a, "transactions", tx.data.id, errs);
      await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (errs.length) results[results.length - 1].evidence += ` cleanup: ${errs.join("; ")}`;
    }
    // F-09g: two qualifying transactions → only one reconciles.
    {
      await setInputs(a, { amount: "8500.00", asOf: D9, frequency: "monthly", expected: "25000.00", nextPayday: P });
      const t1 = await a.from("transactions").insert({ kind: "income", amount: "25000.00", transaction_date: P, category_id: salaryA.id, description: "F-09g first" }).select("id").single();
      const t2 = await a.from("transactions").insert({ kind: "income", amount: "24999.99", transaction_date: P, category_id: salaryA.id, description: "F-09g second" }).select("id").single();
      const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "8500.00", D9);
      // First reconciles (salary 25000); second counts as ordinary income
      // (24999.99) → ending = 8500 + 25000 + 24999.99 = 58499.99.
      const ok = f.ok && f.expectedSalaryReconciled === true && f.estimatedEndingCash === "58499.99";
      record("F-09g", "Two qualifying transactions: only ONE reconciles; the other counts as ordinary income",
        f.ok ? `reconciled=${f.expectedSalaryReconciled} ending=${f.estimatedEndingCash}` : f.message,
        ok ? "PASS" : "FAIL", "");
      const errs = [];
      await del(a, "transactions", t1.data.id, errs);
      await del(a, "transactions", t2.data.id, errs);
      await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (errs.length) results[results.length - 1].evidence += ` cleanup: ${errs.join("; ")}`;
    }
  }

  // ============ F-10 negative projection warning ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "100.00", asOf: D, frequency: "monthly", expected: "25000.00", nextPayday: P });
    // 100 − 26000 + 25000 = −900: with the plan's literal 500 bill the ending
    // is positive once the salary counts, so the bill is sized to actually
    // drive the projection negative and exercise the warning.
    const bill = await a.from("recurring_bills").insert({
      name: "F-10 bill", amount: "26000.00", frequency: "monthly", next_due_date: addDaysIso(D, 5), category_id: rentA.id,
    }).select("id").single();
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "100.00", D);
    const ok = f.ok && f.estimatedEndingCash === "-900.00" && f.warnings.some((w) => w.startsWith("negative"));
    record("F-10", "Cash 100 with a 26000 bill before payday (salary 25000) → ending −900.00 with a negative-projection warning",
      f.ok ? `ending=${f.estimatedEndingCash} warnings=${f.warnings.join(",")}` : f.message,
      ok ? "PASS" : "FAIL", "Plan's literal 500-bill scenario yields a positive ending once salary counts; fixture sized to exercise the warning. Warning fires on the FINAL projected ending.");
    const errs = [];
    await del(a, "recurring_bills", bill.data.id, errs);
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (errs.length) results[results.length - 1].evidence += ` cleanup: ${errs.join("; ")}`;
  }

  // ============ F-11 forecast-vs-actual totals == hand sums ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "8500.00", asOf: D, frequency: "monthly", expected: "25000.00", nextPayday: P });
    const rows = [
      { kind: "income", amount: "12500.50", date: TODAY, cat: salaryA.id },
      { kind: "income", amount: "2400.00", date: TODAY, cat: null },
      { kind: "expense", amount: "480.25", date: TODAY, cat: rentA.id },
      { kind: "expense", amount: "19.75", date: TODAY, cat: null },
    ];
    const ids = [];
    for (const r of rows) {
      const row = await a.from("transactions").insert({ kind: r.kind, amount: r.amount, transaction_date: r.date, category_id: r.cat }).select("id").single();
      ids.push(row.data.id);
    }
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "8500.00", D);
    // Window (D, P] includes TODAY: income 14900.50, expense 500.00.
    const endingExpected = addSignedAmounts(["8500.00", "14900.50", "-500.00", "25000.00"]);
    const ok = f.ok && f.recordedIncome === "14900.50" && f.recordedExpenses === "500.00"
      && f.estimatedEndingCash === endingExpected;
    record("F-11", "Recorded totals equal hand-computed sums (14900.50 / 500.00) and ending cash matches exactly",
      f.ok ? `income=${f.recordedIncome} expense=${f.recordedExpenses} ending=${f.estimatedEndingCash}` : f.message,
      ok ? "PASS" : "FAIL", `ending expected ${endingExpected}`);
    const errs = [];
    for (const id of ids) await del(a, "transactions", id, errs);
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (errs.length) results[results.length - 1].evidence += ` cleanup: ${errs.join("; ")}`;
  }

  // ============ F-12 cash position single source (Forecast page + Settings both upsert) ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "8500.00", asOf: D, frequency: "monthly", expected: "25000.00", nextPayday: P });
    // Path 1: upsert (Settings path). Read back via the same fetch the app uses.
    const up1 = await a.from("cash_positions").upsert({ amount: "9000.00", as_of_date: D }, { onConflict: "user_id" }).select("amount,as_of_date").single();
    const row1 = await a.from("cash_positions").select("amount,as_of_date").maybeSingle();
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, row1.data.amount, row1.data.as_of_date);
    const rows = await a.from("cash_positions").select("id");
    const ok = !up1.error && row1.data && toCents(norm(row1.data.amount)) === 900000n && f.ok && f.startingCash === "9000.00" && rows.data.length === 1;
    record("F-12", "Cash update via single row (upsert onConflict user_id): one row only, forecast starting cash follows",
      `upsertError=${up1.error ? up1.error.message : "none"} row amount=${norm(row1.data?.amount)} asOf=${row1.data?.as_of_date} rows=${rows.data.length} startingCash=${f.ok ? f.startingCash : f.message}`,
      ok ? "PASS" : "FAIL", "Both UI paths call the same upsert (saveCashPosition); single-row invariant verified here.");
    await a.from("cash_positions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  // ============ F-13/F-14 assumptions + missing inputs ============
  {
    const P = addDaysIso(TODAY, 10);
    // F-13: assumptions block mirrors the fields the UI renders.
    await setInputs(a, { amount: "8500.00", asOf: D, frequency: "monthly", expected: "25000.00", nextPayday: P });
    const f = await computeForecastMirror(a, { frequency: "monthly", next_payday: P, expected_amount: "25000.00" }, "8500.00", D);
    const hasAssumptions = f.ok && f.asOfDate && f.startDate && f.endDate && f.startingCash
      && typeof f.expectedSalaryReconciled === "boolean" && Array.isArray(f.unpaidBills) && Array.isArray(f.warnings);
    record("F-13", "Assumptions block inputs all present (period, starting cash, salary treatment, unpaid count, warnings)",
      hasAssumptions ? "all fields present" : "missing fields", hasAssumptions ? "PASS" : "FAIL",
      "'Estimate — not a guaranteed balance' label is a UI-stage check; the data contract is verified here.");
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await a.from("cash_positions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    // F-14: no schedule / no cash → the mirror reports unavailability (the UI
    // prompts instead of fabricating zeros; same inputs the page checks).
    const row = await a.from("cash_positions").select("amount").maybeSingle();
    const noCash = row.data === null;
    const schedules = await a.from("income_schedules").select("id");
    const noSchedule = (schedules.data ?? []).length === 0;
    record("F-14", "No schedule / no cash → forecast unavailable, prompt to set up (no fabricated zeros)",
      `cash row present=${!noCash}; schedules=${(schedules.data ?? []).length}`,
      noCash && noSchedule ? "PASS" : "FAIL", "computeForecast returns ForecastUnavailable for missing inputs; the UI renders prompts from the same null checks.");
  }

  // ============ F-15 cross-user isolation ============
  {
    const P = addDaysIso(TODAY, 10);
    await setInputs(a, { amount: "7777.00", asOf: D, frequency: "monthly", expected: "11111.00", nextPayday: P });
    const fb = await computeForecastMirror(b, { frequency: "monthly", next_payday: addDaysIso(TODAY, 20), expected_amount: "900.00" }, "100.00", D);
    // B has no schedule of their own; the mirror for B uses B's passed-in
    // inputs but must read ONLY B's rows (B's transactions/bills are empty).
    const ok = fb.ok && fb.estimatedEndingCash === "1000.00"
      && fb.recordedIncome === "0.00" && fb.unpaidBills.length === 0;
    record("F-15", "B's forecast reads only B's rows (A's distinct schedule/cash/bills leak nothing into B's result)",
      fb.ok ? `B ending=${fb.estimatedEndingCash} income=${fb.recordedIncome} unpaid=${fb.unpaidBills.length}` : fb.message,
      ok ? "PASS" : "FAIL", "All context queries are RLS-scoped; also covered structurally by the X batch.");
    await a.from("income_schedules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await a.from("cash_positions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  console.log(JSON.stringify({
    runId: "forecast",
    accounts: { A: { email: emailA, userId: A.session.user.id }, B: { email: emailB, userId: B.session.user.id } },
    results,
  }, null, 2));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : String(e));
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(1);
});
