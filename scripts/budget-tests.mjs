// Financial test harness — Budgets batch (B-01 … B-14, docs/testing-plan-financial.md §4).
// Same conventions as scripts/tx-tests.mjs: real anon-key clients + real
// password-auth sessions (RLS applies exactly as in the running app); no
// service-role key anywhere. Reuses the deferred Transactions-stage accounts.
// Prints ids only, never tokens or passwords.
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

// Exact decimal-string cent arithmetic (same rules as src/lib/types.ts).
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

const PASSWORD = "TestOnly-2026-x7";
// The Transactions stage deferred teardown so later stages reuse these exact
// accounts (docs/testing-results-transactions.md).
const emailA = "txa.20261122-tx@aimass-test.invalid";
const emailB = "txb.20261122-tx@aimass-test.invalid";

// Mirror of src/lib/budgets.ts fetchExpenseTotals: overall includes every
// expense (categorized or not); byCategory only holds rows WITH a category.
async function fetchExpenseTotalsRaw(client, from, to) {
  const { data, error } = await client.from("transactions")
    .select("amount,category_id")
    .eq("kind", "expense")
    .gte("transaction_date", from)
    .lte("transaction_date", to);
  let overallCents = 0n;
  const byCategory = new Map();
  for (const row of data ?? []) {
    const cents = toCents(row.amount);
    overallCents += cents;
    if (typeof row.category_id === "string") {
      byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0n) + cents);
    }
  }
  return { overall: centsToDecimalString(overallCents), byCategory, error: error?.message ?? null };
}

// Mirror of src/lib/budgets.ts computeProgress + budgetStatus.
function computeProgressRaw(budget, totals) {
  const spent = budget.category_id
    ? centsToDecimalString(totals.byCategory.get(budget.category_id) ?? 0n)
    : totals.overall;
  const limitCents = toCents(budget.limit_amount);
  const spentCents = toCents(spent);
  const remaining = centsToDecimalString(limitCents - spentCents);
  const percentUsed = limitCents === 0n ? 0 : Number((spentCents * 10000n) / limitCents) / 100;
  const status = percentUsed >= 100 ? "over" : percentUsed >= 80 ? "warning" : "ok";
  return { spent, remaining, percentUsed, status };
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

function monthOf(dateIso) {
  return dateIso.slice(0, 7);
}
function firstOfMonth(ym) {
  return `${ym}-01`;
}
// Mirror of src/lib/types.ts monthRange.
function monthRange(ym) {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  if (!m) return { start: "", end: "" };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, "0")}` };
}
// Mirror of src/lib/budgets.ts buildMonthOptions picker bounds: 6 months back,
// 6 months forward around the current month.
function pickerWindowMonths() {
  const now = new Date();
  const out = [];
  for (let offset = -6; offset <= 5; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

async function main() {
  const A = await createTestUser(emailA);
  const B = await createTestUser(emailB);
  if (!A || !B) {
    record("FX-1/FX-2", "Deferred Transactions-stage accounts sign in with active sessions",
      `A=${A ? "ok" : "FAILED"} B=${B ? "ok" : "FAILED"}`,
      (A && B) ? "PASS" : "BLOCKED",
      adminNote.join(" | "),
      "If BLOCKED: accounts were torn down early; re-provision via SQL as in the Transactions stage, then rerun.");
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }
  record("FX-1", "User A account reuses the deferred Transactions-stage account with a real session", "signInWithPassword returned an active session", "PASS", `email=${A.email} userId=${A.session.user.id}`);
  record("FX-2", "User B reuses the deferred Transactions-stage account with a real session", "signInWithPassword returned an active session", "PASS", `email=${B.email} userId=${B.session.user.id}`);

  const a = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${A.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const b = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${B.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- Fixtures: expense categories for A and B; clean prior leftovers.
  const catsA = await a.from("categories").select("id,name,kind,is_system").order("name");
  const catsB = await b.from("categories").select("id,name,kind,is_system").order("name");
  if (catsA.error || catsB.error) {
    record("FX-4", "Both accounts can list their categories", `A: ${catsA.error?.message ?? "ok"}; B: ${catsB.error?.message ?? "ok"}`, "BLOCKED", "cannot proceed without categories");
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }
  // Default expense categories are Food/Rent/Transportation/Utilities/Health/
  // Entertainment/Other (no Groceries/Transport) — map the plan's names onto
  // the real ones: Groceries→Food, Transport→Transportation.
  const groceriesA = catsA.data.find((c) => c.kind === "expense" && c.name === "Food");
  const transportA = catsA.data.find((c) => c.kind === "expense" && c.name === "Transportation");
  const groceriesB = catsB.data.find((c) => c.kind === "expense" && c.name === "Food");
  const anyExpenseA = catsA.data.find((c) => c.kind === "expense");
  const anyExpenseB = catsB.data.find((c) => c.kind === "expense");
  record("FX-4", "Food (as Groceries) + Transportation (as Transport) expense categories exist for A and B",
    `A food=${groceriesA?.id ?? "MISSING"} transport=${transportA?.id ?? "MISSING"}; B food=${groceriesB?.id ?? "MISSING"}`,
    groceriesA && transportA && groceriesB ? "PASS" : "BLOCKED", "");
  if (!groceriesA || !transportA || !groceriesB || !anyExpenseA || !anyExpenseB) {
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }

  const TODAY = new Date().toISOString().slice(0, 10);
  const YM = monthOf(TODAY);

  // Start from a clean slate for both accounts (prior-stage probes may linger).
  await a.from("budgets").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("budgets").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // ============ B-01 create overall budget ============
  {
    const res = await a.from("budgets").insert({
      month: firstOfMonth(YM), category_id: null, limit_amount: "20000.00",
    }).select("id,month,limit_amount,category_id").single();
    const ok = !res.error && res.data && toCents(res.data.limit_amount) === 2000000n && res.data.category_id === null;
    record("B-01", "Overall budget limit 20000.00 for current month created; reads back with exact cents",
      ok ? `id=${res.data.id} limit=${res.data.limit_amount} month=${res.data.month}` : `error: ${res.error?.message ?? JSON.stringify(res.data)}`,
      ok ? "PASS" : "FAIL", "PostgREST returns numeric as a JSON number; cent comparison confirms exactness. Progress math asserted in B-04.");
  }
  let overallBudgetId = null;
  {
    const row = await a.from("budgets").select("id,limit_amount").eq("month", firstOfMonth(YM)).is("category_id", null).maybeSingle();
    overallBudgetId = row.data?.id ?? null;
  }

  // ============ B-02 category budget ============
  {
    const res = await a.from("budgets").insert({
      month: firstOfMonth(YM), category_id: groceriesA.id, limit_amount: "3000.00",
    }).select("id,category_id,limit_amount").single();
    const ok = !res.error && res.data && toCents(res.data.limit_amount) === 300000n && res.data.category_id === groceriesA.id;
    record("B-02", "Category budget (Groceries, 3000.00) created; one per category per month enforced",
      ok ? `id=${res.data.id} category=${res.data.category_id === groceriesA.id ? "groceries" : "mismatch"}` : `error: ${res.error?.message ?? JSON.stringify(res.data)}`,
      ok ? "PASS" : "FAIL", "");
  }
  let groceriesBudgetId = null;
  {
    const row = await a.from("budgets").select("id").eq("month", firstOfMonth(YM)).eq("category_id", groceriesA.id).maybeSingle();
    groceriesBudgetId = row.data?.id ?? null;
  }

  // ============ B-03 duplicate prevention (DB unique indexes are the backstop) ============
  {
    const dupOverall = await a.from("budgets").insert({
      month: firstOfMonth(YM), category_id: null, limit_amount: "1000.00",
    });
    const dupOverallRejected = Boolean(dupOverall.error);
    if (!dupOverallRejected) {
      const stray = await a.from("budgets").select("id").eq("month", firstOfMonth(YM)).is("category_id", null);
      for (const r of stray.data ?? []) {
        if (r.id !== overallBudgetId) await a.from("budgets").delete().eq("id", r.id);
      }
    }
    const dupCat = await a.from("budgets").insert({
      month: firstOfMonth(YM), category_id: groceriesA.id, limit_amount: "500.00",
    });
    const dupCatRejected = Boolean(dupCat.error);
    if (!dupCatRejected) {
      const stray = await a.from("budgets").select("id").eq("month", firstOfMonth(YM)).eq("category_id", groceriesA.id);
      for (const r of stray.data ?? []) {
        if (r.id !== groceriesBudgetId) await a.from("budgets").delete().eq("id", r.id);
      }
    }
    record("B-03", "Second overall budget and duplicate category budget for the same month are rejected",
      `overall dup rejected=${dupOverallRejected}${dupOverall.error ? ` (${dupOverall.error.message.slice(0, 60)})` : ""}; category dup rejected=${dupCatRejected}${dupCat.error ? ` (${dupCat.error.message.slice(0, 60)})` : ""}`,
      dupOverallRejected && dupCatRejected ? "PASS" : "FAIL",
      "App maps the unique-index violations (budgets_one_overall_per_user_month / budgets_one_per_category_month) to friendly messages; the DB constraint is the enforcement backstop verified here.");
  }

  // ============ B-04 spending calculation ============
  {
    const seed = [
      { kind: "expense", amount: "1000.00", category_id: groceriesA.id, description: "B-04 groceries" },
      { kind: "expense", amount: "250.00", category_id: transportA.id, description: "B-04 transport" },
    ];
    let seeded = true;
    for (const s of seed) {
      const r = await a.from("transactions").insert({
        kind: s.kind, amount: s.amount, transaction_date: TODAY, category_id: s.category_id, description: s.description,
      });
      if (r.error) { seeded = false; break; }
    }
    if (!seeded) {
      record("B-04", "Spent totals: overall 1250.00, groceries 1000.00", "seed failed", "BLOCKED", "");
    } else {
      const totals = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
      const budgets = await a.from("budgets").select("id,category_id,limit_amount").eq("month", firstOfMonth(YM));
      const overall = budgets.data?.find((r) => r.category_id === null);
      const groc = budgets.data?.find((r) => r.category_id === groceriesA.id);
      const pOverall = overall ? computeProgressRaw({ ...overall, category_id: null }, totals) : null;
      const pGroc = groc ? computeProgressRaw(groc, totals) : null;
      const ok = pOverall && pGroc
        && pOverall.spent === "1250.00" && pOverall.remaining === "18750.00" && Math.abs(pOverall.percentUsed - 6.25) < 1e-9
        && pGroc.spent === "1000.00" && pGroc.remaining === "2000.00" && Math.abs(pGroc.percentUsed - 33.33) < 0.01;
      record("B-04", "Overall spent 1250.00 (6.25%); Groceries spent 1000.00 (33.33%); exact cents",
        pOverall && pGroc
          ? `overall spent=${pOverall.spent} remaining=${pOverall.remaining} pct=${pOverall.percentUsed}; groceries spent=${pGroc.spent} remaining=${pGroc.remaining} pct=${pGroc.percentUsed}`
          : "budget rows missing",
        ok ? "PASS" : "FAIL", "Transport has no budget so it only lifts the overall number — asserted by the 1250.00 overall vs 1000.00 groceries split.");
    }
  }

  // ============ B-05 80% threshold boundary ============
  {
    // Groceries budget currently 3000.00; spend 799.99 cumulative must NOT be
    // approaching; 800.00+ must be. Total groceries spend after this case is
    // kept at 800.00 by inserting 1,799.99 on top of the B-04 1000.00? No —
    // use a dedicated boundary: delete B-04 rows first and re-seed cleanly.
    await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    // Shrink the groceries budget to 1000.00 for a crisp boundary.
    const shrunk = await a.from("budgets").update({ limit_amount: "1000.00" }).eq("id", groceriesBudgetId).select("limit_amount").single();
    if (shrunk.error) {
      record("B-05", "80% threshold: 799.99 not approaching; 800.00 approaching", `budget update failed: ${shrunk.error.message}`, "BLOCKED", "");
    } else {
      const r1 = await a.from("transactions").insert({
        kind: "expense", amount: "799.99", transaction_date: TODAY, category_id: groceriesA.id, description: "B-05 boundary probe",
      }).select("id");
      if (r1.error || !r1.data) {
        record("B-05", "80% threshold: 799.99 not approaching; 800.00 approaching", `seed failed: ${r1.error.message}`, "BLOCKED", "");
      } else {
        const totals = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
        const below = computeProgressRaw({ id: groceriesBudgetId, category_id: groceriesA.id, limit_amount: "1000.00" }, totals);
        const u1 = await a.from("transactions").update({ amount: "800.00" }).eq("id", r1.data[0].id).select("amount").single();
        const totals2 = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
        const at = computeProgressRaw({ id: groceriesBudgetId, category_id: groceriesA.id, limit_amount: "1000.00" }, totals2);
        const ok = !u1.error && below.status === "ok" && at.status === "warning"
          && below.percentUsed < 80 && Math.abs(at.percentUsed - 80) < 1e-9;
        record("B-05", "At limit 1000.00: 799.99 spent → ok; 800.00 spent → warning (>=80%)",
          `799.99 → ${below.status} (${below.percentUsed}%); 800.00 → ${at.status} (${at.percentUsed}%)`,
          ok ? "PASS" : "FAIL", "Boundary is >=80% per budgetStatus; both states observed in one probe row.");
        await a.from("transactions").delete().eq("id", r1.data[0].id);
      }
    }
  }

  // ============ B-06 100% threshold + over-amount ============
  {
    const r1 = await a.from("transactions").insert({
      kind: "expense", amount: "1000.00", transaction_date: TODAY, category_id: groceriesA.id, description: "B-06 at-limit probe",
    }).select("id");
    const totals1 = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
    const atLimit = computeProgressRaw({ id: groceriesBudgetId, category_id: groceriesA.id, limit_amount: "1000.00" }, totals1);
    const u1 = await a.from("transactions").update({ amount: "1200.00" }).eq("id", r1.data[0].id).select("amount").single();
    const totals2 = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
    const over = computeProgressRaw({ id: groceriesBudgetId, category_id: groceriesA.id, limit_amount: "1000.00" }, totals2);
    const ok = !r1.error && !u1.error && atLimit.status === "over" && over.status === "over"
      && atLimit.remaining === "0.00" && over.remaining === "-200.00";
    record("B-06", "Spent 1000.00 → over; 1200.00 → over with remaining -200.00",
      `1000.00 → ${atLimit.status} remaining=${atLimit.remaining}; 1200.00 → ${over.status} remaining=${over.remaining}`,
      ok ? "PASS" : "FAIL", "");
    await a.from("transactions").delete().eq("id", r1.data[0].id);
  }

  // ============ B-07 uncategorized expense counts toward overall only ============
  {
    const r1 = await a.from("transactions").insert({
      kind: "expense", amount: "77.77", transaction_date: TODAY, category_id: null, description: "B-07 uncategorized probe",
    }).select("id");
    const totals = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
    const budgets = await a.from("budgets").select("id,category_id,limit_amount").eq("month", firstOfMonth(YM));
    const overall = budgets.data?.find((r) => r.category_id === null);
    const pOverall = overall ? computeProgressRaw({ ...overall, category_id: null }, totals) : null;
    const grocTotals = totals.byCategory.get(groceriesA.id) ?? 0n;
    const ok = !r1.error && pOverall && pOverall.spent === "77.77" && grocTotals === 0n;
    record("B-07", "Uncategorized expense lifts OVERALL spent (77.77) but no category bucket",
      pOverall ? `overall spent=${pOverall.spent}; groceries bucket=${centsToDecimalString(grocTotals)}` : `seed error: ${r1.error?.message}`,
      ok ? "PASS" : "FAIL", "Approved T-05 product rule: uncategorized expenses feed overall totals only.");
    if (!r1.error) await a.from("transactions").delete().eq("id", r1.data[0].id);
  }

  // ============ B-08 income does not count against budgets ============
  {
    const r1 = await a.from("transactions").insert({
      kind: "income", amount: "5000.00", transaction_date: TODAY, category_id: null, description: "B-08 income probe",
    }).select("id");
    const totals = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
    const ok = !r1.error && totals.overall === "0.00" && totals.byCategory.size === 0;
    record("B-08", "Income transaction does not affect expense totals / budgets",
      `overall after income=${totals.overall}`,
      ok ? "PASS" : "FAIL", "fetchExpenseTotals filters kind=expense; income rows are structurally excluded.");
    if (!r1.error) await a.from("transactions").delete().eq("id", r1.data[0].id);
  }

  // ============ B-09 edit limit recomputes ============
  {
    if (!overallBudgetId) {
      record("B-09", "Edit overall limit 20000→15000 recomputes remaining", "overall budget row missing", "BLOCKED", "");
    } else {
      const totals = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
      // totals.overall is 0.00 here (B-04..B-08 probes cleaned up).
      const upd = await a.from("budgets").update({ limit_amount: "15000.00" }).eq("id", overallBudgetId).select("limit_amount").single();
      const after = upd.data ? computeProgressRaw({ ...upd.data, category_id: null }, totals) : null;
      const ok = !upd.error && after && toCents(upd.data.limit_amount) === 1500000n && after.spent === "0.00" && after.remaining === "15000.00";
      record("B-09", "Limit 20000→15000: spent/remaining/percent recompute",
        after ? `limit=${upd.data.limit_amount} spent=${after.spent} remaining=${after.remaining} pct=${after.percentUsed}` : `error: ${upd.error?.message}`,
        ok ? "PASS" : "FAIL", "");
    }
  }

  // ============ B-10 delete with confirmation ============
  {
    const tmp = await a.from("budgets").insert({
      month: firstOfMonth(YM), category_id: transportA.id, limit_amount: "100.00",
    }).select("id").single();
    if (tmp.error) {
      record("B-10", "Delete removes budget row; other data unaffected", `setup failed: ${tmp.error.message}`, "BLOCKED", "");
    } else {
      const del = await a.from("budgets").delete().eq("id", tmp.data.id);
      const confirm = await a.from("budgets").select("id").eq("id", tmp.data.id).maybeSingle();
      const before = await a.from("budgets").select("id").eq("month", firstOfMonth(YM));
      const ok = !del.error && confirm.data === null && (before.data ?? []).length === 2;
      record("B-10", "Deleted budget no longer retrievable; remaining budgets unaffected",
        ok ? "row gone; 2 budgets remain" : `error: ${del.error?.message ?? confirm.error?.message ?? "row still present"}`,
        ok ? "PASS" : "FAIL", "UI confirmation dialog is a browser-stage check; data path verified here.");
    }
  }

  // ============ B-11 month switching + per-month isolation ============
  {
    const window = pickerWindowMonths();
    const nextYm = window.find((ym) => ym > YM);
    if (!nextYm) {
      record("B-11", "Budget for next month creatable via picker window; months isolated", "next month outside picker window", "BLOCKED", "");
    } else {
      const res = await a.from("budgets").insert({
        month: firstOfMonth(nextYm), category_id: null, limit_amount: "999.00",
      }).select("id,month").single();
      const listCurrent = await a.from("budgets").select("id,month").eq("month", firstOfMonth(YM));
      const listNext = await a.from("budgets").select("id,month").eq("month", firstOfMonth(nextYm));
      const inWindow = window.includes(nextYm);
      const ok = !res.error && inWindow
        && (listCurrent.data ?? []).length === 2 && (listNext.data ?? []).length === 1;
      if (!res.error) await a.from("budgets").delete().eq("id", res.data.id);
      record("B-11", "Next-month budget creatable (picker +6/−6); current month unaffected; per-month isolation holds",
        ok ? `created for ${nextYm} (picker window includes it); current month still has 2 budgets; next-month list had exactly 1`
          : `error: ${res.error?.message ?? "isolation broken"}`,
        ok ? "PASS" : "FAIL", `picker window: ${window[0]} … ${window[window.length - 1]}`);
    }
  }

  // ============ B-12 cross-month totals ============
  {
    const window = pickerWindowMonths();
    const prevYm = [...window].reverse().find((ym) => ym < YM);
    if (!prevYm) {
      record("B-12", "Expenses in other months do not count toward this month's budgets", "no prior month in picker window", "BLOCKED", "");
    } else {
      const r1 = await a.from("transactions").insert({
        kind: "expense", amount: "444.00", transaction_date: monthRange(prevYm).end, category_id: groceriesA.id,
        description: "B-12 prior-month probe",
      }).select("id");
      const totals = await fetchExpenseTotalsRaw(a, monthRange(YM).start, monthRange(YM).end);
      const ok = !r1.error && totals.overall === "0.00";
      record("B-12", `Expense dated ${monthRange(prevYm).end} (previous month) does not lift the current month's totals`,
        ok ? `current-month overall=${totals.overall}` : `seed error: ${r1.error?.message ?? "leaked into current month"}`,
        ok ? "PASS" : "FAIL", "fetchExpenseTotals is bounded by monthRange(ym) start/end.");
      if (!r1.error) await a.from("transactions").delete().eq("id", r1.data[0].id);
    }
  }

  // ============ B-13 cross-user isolation (B vs A's budgets) ============
  {
    if (!overallBudgetId) {
      record("B-13", "B cannot read/mutate A's budgets; B's own budgets independent", "A fixture missing", "BLOCKED", "");
    } else {
      const readB = await b.from("budgets").select("id").eq("id", overallBudgetId);
      const readDenied = (readB.data ?? []).length === 0;
      const upd = await b.from("budgets").update({ limit_amount: "1.00" }).eq("id", overallBudgetId).select("id");
      const updDenied = (upd.data ?? []).length === 0;
      const del = await b.from("budgets").delete().eq("id", overallBudgetId).select("id");
      const delDenied = (del.data ?? []).length === 0;
      const forged = await b.from("budgets").insert({
        month: firstOfMonth(YM), category_id: null, limit_amount: "50.00", user_id: A.session.user.id,
      });
      const forgedDenied = Boolean(forged.error);
      const own = await b.from("budgets").insert({
        month: firstOfMonth(YM), category_id: groceriesB.id, limit_amount: "500.00",
      }).select("id").single();
      const ownOk = !own.error;
      const verify = await a.from("budgets").select("limit_amount").eq("id", overallBudgetId).maybeSingle();
      const intact = !!verify.data && toCents(verify.data.limit_amount) === 1500000n;
      if (ownOk) await b.from("budgets").delete().eq("id", own.data.id);
      const ok = readDenied && updDenied && delDenied && forgedDenied && ownOk && intact;
      record("B-13", "B read/update/delete on A's budget → zero rows; forged user_id insert rejected; B can create own",
        `read=${readDenied} update=${updDenied} delete=${delDenied} forgedInsert=${forgedDenied} ownCreate=${ownOk} intact=${intact}`,
        ok ? "PASS" : "FAIL",
        `${readB.error?.message ?? ""} | ${upd.error?.message ?? ""} | ${del.error?.message ?? ""} | ${forged.error?.message?.slice(0, 60) ?? ""}`.trim());
    }
  }

  // ============ B-14 invalid inputs (DB backstop) ============
  {
    const cases = [["0", "zero"], ["-5", "negative"], ["abc", "non-numeric"]];
    const evidence = [];
    let allRejected = true;
    for (const [raw, label] of cases) {
      const res = await a.from("budgets").insert({
        month: firstOfMonth(YM), category_id: null, limit_amount: raw,
      });
      if (res.error) {
        evidence.push(`${label} (${raw}): rejected (${res.error.message.slice(0, 55)})`);
      } else {
        allRejected = false;
        evidence.push(`${label} (${raw}): ACCEPTED (unexpected)`);
        const stray = await a.from("budgets").select("id,limit_amount").eq("month", firstOfMonth(YM)).is("category_id", null);
        for (const r of stray.data ?? []) {
          if (r.id !== overallBudgetId) await a.from("budgets").delete().eq("id", r.id);
        }
      }
    }
    // App-layer format mirror: "abc" and "" must be caught by the UI validator
    // (parsePositiveAmount) before any write; zero/negative fall through to the DB check.
    record("B-14", "limit 0 / negative / non-numeric all rejected (limit_amount > 0 DB-enforced)",
      allRejected ? "all rejected" : evidence.join("; "),
      allRejected ? "PASS" : "FAIL", evidence.join(" | "));
  }

  // ---- Cleanup: A's budgets + transactions removed; B left clean. Accounts
  // stay for the Bills stage.
  await a.from("budgets").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("budgets").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await b.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  console.log(JSON.stringify({
    runId: "budgets",
    accounts: { A: { email: emailA, userId: A.session.user.id }, B: { email: emailB, userId: B.session.user.id } },
    results,
  }, null, 2));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : String(e));
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(1);
});
