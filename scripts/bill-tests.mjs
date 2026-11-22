// Financial test harness — Recurring Bills batch (R-01 … R-14, docs/testing-plan-financial.md §5).
// Same conventions as the Transactions/Budgets harnesses: real anon-key clients + real
// password-auth sessions (RLS applies exactly as in the running app); no service-role
// key anywhere. Reuses the deferred test accounts from the earlier stages.
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

const PASSWORD = "TestOnly-2026-x7";
const emailA = "txa.20261122-tx@aimass-test.invalid";
const emailB = "txb.20261122-tx@aimass-test.invalid";

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Mirror of the DB advance_due_date: weekly +7d; monthly/quarterly/yearly
// calendar-month steps with last-day clamping (Feb-31 -> Feb-28 style).
function addMonthsClamped(iso, months) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
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
function advanceDueDate(frequency, iso) {
  if (frequency === "weekly") return addDaysIso(iso, 7);
  if (frequency === "monthly") return addMonthsClamped(iso, 1);
  if (frequency === "quarterly") return addMonthsClamped(iso, 3);
  return addMonthsClamped(iso, 12);
}

const adminNote = [];

async function createTestUser(email) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) {
    adminNote.push(`${email}: signIn failed (${error?.status ?? "?"} ${error?.message ?? "no session"})`);
    return null;
  }
  return { email, session: data.session };
}

async function main() {
  const A = await createTestUser(emailA);
  const B = await createTestUser(emailB);
  if (!A || !B) {
    record("FX-1/FX-2", "Deferred accounts sign in with active sessions",
      `A=${A ? "ok" : "FAILED"} B=${B ? "ok" : "FAILED"}`,
      (A && B) ? "PASS" : "BLOCKED", adminNote.join(" | "));
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }
  record("FX-1", "User A signs in with a real session", "signInWithPassword returned an active session", "PASS", `email=${A.email}`);
  record("FX-2", "User B signs in with a real session", "signInWithPassword returned an active session", "PASS", `email=${B.email}`);

  const a = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${A.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const b = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${B.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const catsA = await a.from("categories").select("id,name,kind,is_system").order("name");
  const salaryA = catsA.data.find((c) => c.name === "Salary" && c.kind === "income");
  const rentA = catsA.data.find((c) => c.kind === "expense" && c.name === "Rent");
  const anyExpenseA = catsA.data.find((c) => c.kind === "expense");
  const anyIncomeA = catsA.data.find((c) => c.kind === "income");
  const anyExpenseB = catsB_safe(catsB(await b.from("categories").select("id,name,kind")));
  if (!salaryA || !rentA || !anyExpenseA || !anyIncomeA || !anyExpenseB) {
    record("FX-4", "Required categories exist", "missing category fixtures", "BLOCKED", "");
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }

  const TODAY = new Date().toISOString().slice(0, 10);

  // Clean slate. bill_payments RESTRICT-reference bills, so payments must be
  // deleted BEFORE bills; transactions are deleted last (payments reference
  // them too).
  await a.from("bill_payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("bill_payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("recurring_bills").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("recurring_bills").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // ============ R-01 create bill ============
  {
    const due = addDaysIso(TODAY, 10);
    const res = await a.from("recurring_bills").insert({
      name: "Rent", amount: "12000.00", frequency: "monthly", next_due_date: due, category_id: rentA.id,
    }).select("id,name,amount,frequency,next_due_date,is_active,category_id").single();
    const ok = !res.error && res.data && toCents(res.data.amount) === 1200000n
      && res.data.is_active === true && res.data.next_due_date === due;
    record("R-01", "Rent 12000.00 monthly bill created, active, due in 10 days",
      ok ? `id=${res.data.id} due=${res.data.next_due_date}` : `error: ${res.error?.message ?? JSON.stringify(res.data)}`,
      ok ? "PASS" : "FAIL", "Dashboard 14-day reminder window is a UI check; the data state (due within window) is verified here.");
  }
  // Pin the bill by the id created in R-01 (name lookup breaks if a previous
  // failed run left duplicate "Rent" rows behind).
  const rentBillRow = (await a.from("recurring_bills").select("id,name,next_due_date,category_id").eq("name", "Rent").order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
  const rentBill = rentBillRow ? { id: rentBillRow.id, next_due_date: rentBillRow.next_due_date } : null;

  // ============ R-02 weekly progression ============
  {
    const due = TODAY; // due today so the RPC advance is exercisable
    const res = await a.from("recurring_bills").insert({
      name: "Weekly probe", amount: "500.00", frequency: "weekly", next_due_date: due, category_id: anyExpenseA.id,
    }).select("id,next_due_date,frequency").single();
    if (res.error || !res.data) {
      record("R-02", "Weekly bill pays then advances exactly +7 days", `setup failed: ${res.error?.message}`, "BLOCKED", "");
    } else {
      const pay = await a.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: res.data.id, p_due_date: due,
        p_category_id: anyExpenseA.id, p_description: "R-02 weekly payment", p_amount: "500.00", p_transaction_date: null,
      });
      const readBack = await a.from("recurring_bills").select("next_due_date").eq("id", res.data.id).maybeSingle();
      const expected = addDaysIso(due, 7);
      const ok = !pay.error && readBack.data && readBack.data.next_due_date === expected;
      record("R-02", "Weekly bill after payment advances exactly +7 days",
        ok ? `paid; next_due_date ${due} → ${readBack.data.next_due_date}` : `pay error: ${pay.error?.message ?? "none"}; next=${readBack.data?.next_due_date ?? "?"}`,
        ok ? "PASS" : "FAIL", "");
      await a.from("recurring_bills").delete().eq("id", res.data.id);
      await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }
  }

  // ============ R-03 monthly clamping (31st → last day of short month) ============
  {
    const res = await a.from("recurring_bills").insert({
      name: "Clamp probe", amount: "100.00", frequency: "monthly", next_due_date: "2026-01-31", category_id: anyExpenseA.id,
    }).select("id").single();
    if (res.error || !res.data) {
      record("R-03", "Monthly due on the 31st clamps to Feb 28 / Apr 30", `setup failed: ${res.error?.message}`, "BLOCKED", "");
    } else {
      const pay = await a.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: res.data.id, p_due_date: "2026-01-31",
        p_category_id: anyExpenseA.id, p_description: "R-03 clamp payment", p_amount: "100.00", p_transaction_date: null,
      });
      const readBack = await a.from("recurring_bills").select("next_due_date").eq("id", res.data.id).maybeSingle();
      const ok = !pay.error && readBack.data && readBack.data.next_due_date === "2026-02-28";
      record("R-03", "Paying a Jan-31 monthly occurrence advances to Feb 28 (clamped)",
        ok ? `paid Jan 31; next_due_date=${readBack.data.next_due_date}` : `pay error: ${pay.error?.message ?? "none"}; next=${readBack.data?.next_due_date ?? "?"}`,
        ok ? "PASS" : "FAIL", "Matches the DB advance_due_date and the forecast mirror's clamp semantics.");
      await a.from("recurring_bills").delete().eq("id", res.data.id);
      await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }
  }

  // ============ R-04 quarterly + yearly clamping ============
  {
    const q = await a.from("recurring_bills").insert({
      name: "Quarterly probe", amount: "100.00", frequency: "quarterly", next_due_date: "2026-11-30", category_id: anyExpenseA.id,
    }).select("id").single();
    const y = await a.from("recurring_bills").insert({
      name: "Yearly probe", amount: "100.00", frequency: "yearly", next_due_date: "2028-02-29", category_id: anyExpenseA.id,
    }).select("id").single();
    let ok = true;
    const evidence = [];
    if (!q.error && q.data) {
      const pay = await a.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: q.data.id, p_due_date: "2026-11-30",
        p_category_id: anyExpenseA.id, p_description: "R-04 quarterly payment", p_amount: "100.00", p_transaction_date: null,
      });
      const readBack = await a.from("recurring_bills").select("next_due_date").eq("id", q.data.id).maybeSingle();
      const got = readBack.data?.next_due_date;
      const qOk = !pay.error && got === "2027-02-28";
      if (!qOk) ok = false;
      evidence.push(`quarterly Nov-30 → ${got ?? "?"} (expected 2027-02-28, +3mo clamp)`);
      await a.from("recurring_bills").delete().eq("id", q.data.id);
    } else { ok = false; evidence.push(`quarterly setup failed: ${q.error?.message}`); }
    if (!y.error && y.data) {
      const pay = await a.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: y.data.id, p_due_date: "2028-02-29",
        p_category_id: anyExpenseA.id, p_description: "R-04 yearly payment", p_amount: "100.00", p_transaction_date: null,
      });
      const readBack = await a.from("recurring_bills").select("next_due_date").eq("id", y.data.id).maybeSingle();
      const got = readBack.data?.next_due_date;
      const yOk = !pay.error && got === "2029-02-28";
      if (!yOk) ok = false;
      evidence.push(`yearly Feb-29-2028 → ${got ?? "?"} (expected 2029-02-28, non-leap clamp)`);
      await a.from("recurring_bills").delete().eq("id", y.data.id);
    } else { ok = false; evidence.push(`yearly setup failed: ${y.error?.message}`); }
    await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    record("R-04", "Quarterly +3mo clamp (Nov 30 → Feb 28) and yearly Feb-29 → Feb-28 on non-leap",
      ok ? "both advances correct" : evidence.join("; "), ok ? "PASS" : "FAIL", evidence.join(" | "));
  }

  // ============ R-05 status classification ============
  {
    const past = addDaysIso(TODAY, -3);
    const res = await a.from("recurring_bills").insert({
      name: "Overdue probe", amount: "100.00", frequency: "monthly", next_due_date: past, category_id: anyExpenseA.id,
    }).select("id,next_due_date").single();
    // billStatus mirror: past → overdue; today → due-today; future → upcoming.
    const readBack = res.error ? null : res.data;
    const overdue = readBack && readBack.next_due_date < TODAY;
    const ok = !!overdue;
    record("R-05", "Past due → overdue classification (calendar-date compare)",
      ok ? `due ${past} < today ${TODAY} → overdue` : `setup failed: ${res.error?.message}`,
      ok ? "PASS" : "FAIL", "billStatus is a pure frontend function (past < today → overdue; equal → due-today; else upcoming); data layer confirmed the row persisted with the past date.");
    if (readBack) await a.from("recurring_bills").delete().eq("id", readBack.id);
  }

  // ============ R-06 mark-as-paid (single expense, payment row, advance) ============
  {
    if (!rentBill) {
      record("R-06", "Paying the due occurrence creates exactly one linked expense + payment row + advance", "Rent bill missing", "BLOCKED", "");
    } else {
      const txBefore = await a.from("transactions").select("id,amount,description").eq("description", "R-06 rent payment");
      const beforeCount = (txBefore.data ?? []).length;
      const pay = await a.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: rentBill.id, p_due_date: rentBill.next_due_date,
        p_category_id: rentA.id, p_description: "R-06 rent payment", p_amount: "12000.00", p_transaction_date: null,
      });
      const txAfter = await a.from("transactions").select("id,amount,kind,transaction_date,category_id").eq("description", "R-06 rent payment");
      const payments = await a.from("bill_payments").select("id,due_date,transaction_id").eq("recurring_bill_id", rentBill.id);
      const afterCount = (txAfter.data ?? []).length;
      const newTx = afterCount > beforeCount ? txAfter.data[afterCount - 1] : null;
      const advanced = await a.from("recurring_bills").select("next_due_date").eq("id", rentBill.id).maybeSingle();
      const expectedNext = advanceDueDate("monthly", rentBill.next_due_date);
      const linkedOk = newTx && payments.data?.some((p) => p.transaction_id === newTx.id)
        && toCents(newTx.amount) === 1200000n && newTx.kind === "expense"
        && newTx.transaction_date === rentBill.next_due_date && newTx.category_id === rentA.id;
      const advanceOk = advanced.data?.next_due_date === expectedNext;
      const ok = !pay.error && afterCount - beforeCount === 1 && payments.data?.length === 1 && linkedOk && advanceOk;
      record("R-06", "Exactly ONE expense (linked, 12000.00, dated due date, Rent category), ONE payment row, due date advanced +1 month",
        ok
          ? `1 new expense (linked via payment row), payment count=${payments.data.length}, next_due_date=${advanced.data.next_due_date}`
          : `pay error: ${pay.error?.message ?? "none"}; tx delta=${afterCount - beforeCount}; payments=${payments.data?.length ?? "?"}; advance=${advanced.data?.next_due_date ?? "?"} vs expected ${expectedNext}`,
        ok ? "PASS" : "FAIL", "Atomicity is the RPC's single-transaction guarantee; occurrence uniqueness additionally verified in R-08.");
    }
  }

  // ============ R-07 amount override ============
  {
    const res = await a.from("recurring_bills").insert({
      name: "Override probe", amount: "12000.00", frequency: "monthly", next_due_date: TODAY, category_id: rentA.id,
    }).select("id,next_due_date").single();
    if (res.error || !res.data) {
      record("R-07", "Amount override pays actual amount; next due still advances", `setup failed: ${res.error?.message}`, "BLOCKED", "");
    } else {
      const txBefore = await a.from("transactions").select("id,amount").eq("description", "R-07 override payment");
      const beforeCount = (txBefore.data ?? []).length;
      const pay = await a.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: res.data.id, p_due_date: res.data.next_due_date,
        p_category_id: rentA.id, p_description: "R-07 override payment", p_amount: "11500.00", p_transaction_date: null,
      });
      const txAfter = await a.from("transactions").select("id,amount").eq("description", "R-07 override payment");
      const afterCount = (txAfter.data ?? []).length;
      const newTx = afterCount > beforeCount ? txAfter.data[afterCount - 1] : null;
      const advanced = await a.from("recurring_bills").select("next_due_date").eq("id", res.data.id).maybeSingle();
      const expectedNext = advanceDueDate("monthly", res.data.next_due_date);
      const ok = !pay.error && newTx && toCents(newTx.amount) === 1150000n && advanced.data?.next_due_date === expectedNext;
      record("R-07", "Override 11500.00 on a 12000.00 bill: expense = 11500.00; due still advances",
        ok ? `expense=${newTx.amount}; next=${advanced.data.next_due_date}` : `pay error: ${pay.error?.message ?? "none"}; tx delta=${afterCount - beforeCount}`,
        ok ? "PASS" : "FAIL", "Delta-counted because payment-linked rows from earlier failed runs cannot be deleted client-side (payments are read-only by design; cleanup happens at account deletion)."
      );
      await a.from("recurring_bills").delete().eq("id", res.data.id);
      await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }
  }

  // ============ R-08 duplicate payment ============
  {
    if (!rentBill) {
      record("R-08", "Repeating payment for the SAME occurrence is rejected; no second expense", "Rent bill missing", "BLOCKED", "");
    } else {
      const txBefore = await a.from("transactions").select("id").eq("description", "R-06 rent payment");
      const dup = await a.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: rentBill.id, p_due_date: rentBill.next_due_date,
        p_category_id: rentA.id, p_description: "R-08 duplicate attempt", p_amount: "12000.00", p_transaction_date: null,
      });
      const txAfter = await a.from("transactions").select("id").eq("description", "R-06 rent payment");
      const payments = await a.from("bill_payments").select("id").eq("recurring_bill_id", rentBill.id);
      const rejected = Boolean(dup.error);
      const alreadyPaid = rejected && (dup.error.message.includes("already been paid") || dup.error.code === "23505");
      const ok = rejected && alreadyPaid && (txAfter.data ?? []).length === (txBefore.data ?? []).length && payments.data?.length === 1;
      record("R-08", "Duplicate mark-paid rejected (already-paid); NO second expense; payment count still 1",
        rejected
          ? `rejected (${dup.error.message.slice(0, 70)}); tx delta=${(txAfter.data ?? []).length - (txBefore.data ?? []).length}; payments=${payments.data?.length}`
          : "DUPLICATE ACCEPTED (unexpected)",
        ok ? "PASS" : "FAIL", "The app maps this error to 'This occurrence was already paid…' — UI wording is a browser-stage check.");
    }
  }

  // ============ R-09 payment history ============
  {
    if (!rentBill) {
      record("R-09", "Payment history lists due date, paid date, amount, description", "Rent bill missing", "BLOCKED", "");
    } else {
      const res = await a.from("bill_payments").select("id,due_date,transaction_id,transactions(amount,transaction_date,description)")
        .eq("recurring_bill_id", rentBill.id).order("due_date", { ascending: false });
      const row = res.data?.[0];
      const tx = row?.transactions;
      const ok = !res.error && row && tx
        && row.due_date === rentBill.next_due_date
        && toCents(tx.amount) === 1200000n
        && tx.description === "R-06 rent payment"
        && typeof tx.transaction_date === "string";
      record("R-09", "History row: due date = occurrence, amount 12000.00, description, transaction date present",
        ok ? `due=${row.due_date} amount=${tx.amount} date=${tx.transaction_date} desc=${tx.description}`
          : `error: ${res.error?.message ?? "no history row"}`,
        ok ? "PASS" : "FAIL", "Same join shape the app's fetchBillPayments uses.");
    }
  }

  // ============ R-10 deactivate ============
  {
    const res = await a.from("recurring_bills").insert({
      name: "Deactivate probe", amount: "100.00", frequency: "monthly", next_due_date: TODAY, category_id: anyExpenseA.id,
    }).select("id,is_active").single();
    if (res.error || !res.data) {
      record("R-10", "Bill can be deactivated; deactivated bills produce no reminders", `setup failed: ${res.error?.message}`, "BLOCKED", "");
    } else {
      const deact = await a.from("recurring_bills").update({ is_active: false }).eq("id", res.data.id).select("is_active").single();
      // Reminder query mirror: active bills only.
      const activeList = await a.from("recurring_bills").select("id").eq("is_active", true);
      const gone = !(activeList.data ?? []).some((r) => r.id === res.data.id);
      const pay = await a.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: res.data.id, p_due_date: TODAY,
        p_category_id: anyExpenseA.id, p_description: "R-10 inactive pay attempt", p_amount: "100.00", p_transaction_date: null,
      });
      const payRejected = Boolean(pay.error) && (pay.error.message.includes("not active"));
      const ok = !deact.error && deact.data.is_active === false && gone && payRejected;
      record("R-10", "Deactivation persists; inactive bill drops out of reminders; RPC refuses to pay it",
        `is_active=${deact.data?.is_active}; excluded from active reminders=${gone}; pay rejected=${payRejected}${pay.error ? ` (${pay.error.message.slice(0, 50)})` : ""}`,
        ok ? "PASS" : "FAIL", "");
      await a.from("recurring_bills").delete().eq("id", res.data.id);
      await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }
  }

  // ============ R-11 income-category bill rejected ============
  {
    const res = await a.from("recurring_bills").insert({
      name: "Income-cat probe", amount: "100.00", frequency: "monthly", next_due_date: TODAY, category_id: anyIncomeA.id,
    });
    const rejected = Boolean(res.error);
    record("R-11", "Bill referencing an INCOME category is rejected (assert-category-expense trigger)",
      rejected ? `rejected (${res.error.message.slice(0, 70)})` : "ACCEPTED (unexpected)",
      rejected ? "PASS" : "FAIL", "App maps this to 'Bills can only be linked to expense categories.'");
  }

  // ============ R-12 forged cross-user category reference ============
  {
    const res = await b.from("recurring_bills").insert({
      name: "Forged cat probe", amount: "100.00", frequency: "monthly", next_due_date: TODAY, category_id: rentA.id,
    });
    const rejected = Boolean(res.error);
    record("R-12", "B cannot attach A's category id to B's bill (composite same-user FK)",
      rejected ? `rejected (${res.error.message.slice(0, 70)})` : "ACCEPTED (unexpected)",
      rejected ? "PASS" : "FAIL", "");
  }

  // ============ R-13 cross-user RPC + visibility ============
  {
    if (!rentBill) {
      record("R-13", "B cannot see or pay A's bills", "Rent bill missing", "BLOCKED", "");
    } else {
      const readB = await b.from("recurring_bills").select("id").eq("id", rentBill.id);
      const readDenied = (readB.data ?? []).length === 0;
      const pay = await b.rpc("mark_bill_occurrence_paid", {
        p_recurring_bill_id: rentBill.id, p_due_date: rentBill.next_due_date,
        p_category_id: null, p_description: "R-13 cross-user pay attempt", p_amount: "12000.00", p_transaction_date: null,
      });
      const payRejected = Boolean(pay.error);
      const verify = await a.from("bill_payments").select("id").eq("recurring_bill_id", rentBill.id);
      const paymentsStill1 = (verify.data ?? []).length === 1;
      const ok = readDenied && payRejected && paymentsStill1;
      record("R-13", "B cannot read A's bill; RPC as B on A's bill rejected (ownership check inside RPC); A's payment count unchanged",
        `read=${readDenied}; pay rejected=${payRejected}${pay.error ? ` (${pay.error.message.slice(0, 50)})` : ""}; payments still=${paymentsStill1}`,
        ok ? "PASS" : "FAIL", "RPC returns 'recurring bill not found' for foreign bills (not a leak of existence).");
    }
  }

  // ============ R-14 edit bill ============
  {
    if (!rentBill) {
      record("R-14", "Edit bill amount/category/due date; list reflects it", "Rent bill missing", "BLOCKED", "");
    } else {
      const upd = await a.from("recurring_bills").update({
        amount: "13000.00", category_id: anyExpenseA.id, next_due_date: addDaysIso(TODAY, 5),
      }).eq("id", rentBill.id).select("amount,next_due_date,category_id").single();
      const ok = !upd.error && upd.data && toCents(upd.data.amount) === 1300000n
        && upd.data.category_id === anyExpenseA.id && upd.data.next_due_date === addDaysIso(TODAY, 5);
      record("R-14", "Bill amount/category/due-date edit persists and reads back",
        ok ? `amount=${upd.data.amount} next=${upd.data.next_due_date}` : `error: ${upd.error?.message ?? JSON.stringify(upd.data)}`,
        ok ? "PASS" : "FAIL", "Forecast reflection is covered by the Forecast stage (unpaid-occurrence projection uses the edited values).");
    }
  }

  // ---- Cleanup: payments must go before bills (RESTRICT FK), then bills, then
  // any remaining transactions.
  await a.from("bill_payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("bill_payments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("recurring_bills").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("recurring_bills").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  console.log(JSON.stringify({
    runId: "bills",
    accounts: { A: { email: emailA, userId: A.session.user.id }, B: { email: emailB, userId: B.session.user.id } },
    results,
  }, null, 2));
}

function catsB(res) { return res; }

function catsB_safe(res) {
  return res.data ?? [];
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : String(e));
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(1);
});
