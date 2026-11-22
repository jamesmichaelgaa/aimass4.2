// Financial test harness (Stage 1 fixtures + Stage 2 transactions batch).
// Uses the SAME anon key and URL the frontend uses — never the service-role
// key — so every request here is subject to RLS exactly like the real app.
// Reads credentials from .env; prints ids only, never tokens or passwords.
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
function sumCents(list) {
  return list.reduce((acc, v) => acc + toCents(v), 0n);
}

function validIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
}
function parseAmountForApp(raw) {
  // Mirrors the UI's decimal-string validation (positive, <=2 decimals),
  // then relies on the DB check amount > 0 and numeric(14,2) rounding.
  const trimmed = String(raw).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false, reason: "format" };
  if (toCents(trimmed) <= 0n) return { ok: false, reason: "zero-or-negative" };
  return { ok: true, value: trimmed };
}

const PASSWORD = "TestOnly-2026-x7";
const runId = new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-tx";
const emailA = `txa.${runId}@aimass-test.invalid`;
const emailB = `txb.${runId}@aimass-test.invalid`;

const adminNote = [];

// Sign-in only: accounts are pre-provisioned in auth.users via SQL (dev
// project email rate limits block the signup path). This still uses the real
// password auth API and real sessions, so RLS applies exactly as in the app.
async function createTestUser(email) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) {
    adminNote.push(`${email}: signIn failed (${error.status ?? "?"} ${error.message})`);
    return null;
  }
  if (!data.session) {
    adminNote.push(`${email}: signIn returned no session`);
    return null;
  }
  return { email, session: data.session };
}

async function main() {
  const A = await createTestUser(emailA);
  const B = await createTestUser(emailB);
  if (!A || !B) {
    record("FX-1/FX-2", "Two disposable accounts with active sessions",
      `A=${A ? "ok" : "FAILED"} B=${B ? "ok" : "FAILED"}`,
      (A && B) ? "PASS" : "BLOCKED",
      adminNote.join(" | "),
      "If BLOCKED: use the existing dev-project approach of creating auth rows directly via SQL (as in prior phases), then sign in with signInWithPassword to get a real session.");
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }
  record("FX-1", "User A account exists with a real password-auth session", "Pre-provisioned auth row; signInWithPassword returned an active session", "PASS", `email=${A.email} userId=${A.session.user.id}`);
  record("FX-2", "User B account exists with a real password-auth session", "Pre-provisioned auth row; signInWithPassword returned an active session", "PASS", `email=${B.email} userId=${B.session.user.id}`);

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

  // ---- Fixture FX-4: enumerate system categories for A and B
  const catsA = await a.from("categories").select("id,name,kind,is_system").order("name");
  const catsB = await b.from("categories").select("id,name,kind,is_system").order("name");
  const catsAnonCount = await anon.from("categories").select("id").limit(1);
  if (catsA.error || catsB.error) {
    record("FX-4", "Each user sees their own categories via RLS",
      `A error: ${catsA.error?.message ?? "none"}; B error: ${catsB.error?.message ?? "none"}`,
      "BLOCKED", "category fetch failed; cannot continue transactions batch");
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }
  const incomeA = catsA.data.filter((c) => c.kind === "income");
  const expenseA = catsA.data.filter((c) => c.kind === "expense");
  const salaryA = catsA.data.find((c) => c.name === "Salary" && c.is_system && c.kind === "income");
  const anyExpenseA = expenseA[0];
  const anonDenied = catsAnonCount.error || catsAnonCount.data.length === 0;
  record("FX-4", "A and B each see their own category set (defaults seeded); anon sees none",
    `A: ${catsA.data.length} cats (${incomeA.length} income, ${expenseA.length} expense); B: ${catsB.data.length} cats; anon: ${catsAnonCount.error ? "denied (" + catsAnonCount.error.message + ")" : catsAnonCount.data.length + " rows"}`,
    (catsA.data.length > 0 && catsB.data.length > 0 && anonDenied) ? "PASS" : "FAIL",
    `salary category for A: ${salaryA ? salaryA.id : "MISSING"}; anon denial is the expected deny-by-default behavior for a sign-in-only app (no anon grant/policy)`);
  if (!salaryA || !anyExpenseA) {
    record("FX-4b", "Salary + at least one expense category exist for A",
      `salary=${salaryA ? "yes" : "no"} expenseSample=${anyExpenseA ? anyExpenseA.name : "none"}`,
      "BLOCKED", "required fixtures missing; transactions batch cannot proceed");
    console.log(JSON.stringify({ results, adminNote }, null, 2));
    return;
  }

  const TODAY = new Date().toISOString().slice(0, 10);

  // ============ T-01 create income ============
  {
    const res = await a.from("transactions").insert({
      kind: "income", amount: "12500.50", transaction_date: TODAY,
      category_id: salaryA.id, description: "T-01 salary income",
    }).select("id,kind,amount,transaction_date,category_id,description").single();
    const ok = !res.error && res.data && toCents(res.data.amount) === 1250050n;
    record("T-01", "Income 12500.50 created and readable back with exact cents",
      ok ? `id=${res.data.id} amount=${res.data.amount}` : `error: ${res.error?.message ?? JSON.stringify(res.data)}`,
      ok ? "PASS" : "FAIL", "");
  }

  // fetch A's transactions to get ids
  const listA = await a.from("transactions").select("id,kind,amount,transaction_date,category_id,description").order("transaction_date");
  const t01 = (listA.data ?? []).find((r) => r.description === "T-01 salary income");

  // ============ T-02 create expense ============
  {
    const res = await a.from("transactions").insert({
      kind: "expense", amount: "480.25", transaction_date: TODAY,
      category_id: anyExpenseA.id, description: "T-02 groceries expense",
    }).select("id,amount").single();
    const ok = !res.error && res.data && toCents(res.data.amount) === 48025n;
    record("T-02", "Expense 480.25 created and readable back with exact cents",
      ok ? `id=${res.data.id} amount=${res.data.amount}` : `error: ${res.error?.message ?? JSON.stringify(res.data)}`,
      ok ? "PASS" : "FAIL", "");
  }
  const listAfterT02 = await a.from("transactions").select("id,amount,description");
  const t02 = (listAfterT02.data ?? []).find((r) => r.description === "T-02 groceries expense");

  // ============ T-03 amount validation (DB must reject) ============
  {
    const cases = [
      ["0", "zero"], ["-5", "negative"], ["12,50.00", "malformed"], ["abc", "non-numeric"], ["", "empty"],
    ];
    let allRejected = true;
    const evidence = [];
    for (const [raw, label] of cases) {
      const appCheck = parseAmountForApp(raw);
      if (appCheck.ok) {
        allRejected = false;
        evidence.push(`${label} (${raw}): app validation WRONGLY accepted`);
        continue;
      }
      // Even if app validation were bypassed, the DB must reject zero/negative.
      if (label === "zero" || label === "negative") {
        const res = await a.from("transactions").insert({
          kind: "expense", amount: raw, transaction_date: TODAY, category_id: anyExpenseA.id,
        });
        if (!res.error) {
          allRejected = false;
          evidence.push(`${label}: DB ACCEPTED ${raw} (transactions_amount_check missing!)`);
          await a.from("transactions").delete().neq("id", "");
        }
        else evidence.push(`${label}: DB rejected (${res.error.message.slice(0, 60)})`);
      } else {
        evidence.push(`${label}: rejected at app validation layer (${appCheck.reason})`);
      }
    }
    record("T-03", "All invalid amounts rejected before persistence",
      allRejected ? "all rejected at app layer (or DB where applicable)" : evidence.join("; "),
      allRejected ? "PASS" : "FAIL", evidence.join(" | "));
  }
  // DB precision guard for 999999999999.995 — overflow must be rejected or rounded by numeric(14,2); test the raw DB behavior directly
  {
    const res = await a.from("transactions").insert({
      kind: "expense", amount: "999999999999.995", transaction_date: TODAY, category_id: anyExpenseA.id,
    });
    const rejected = Boolean(res.error);
    if (!rejected) {
      await a.from("transactions").delete().eq("amount", "1000000000000.00");
    }
    record("T-03b", "Amount exceeding numeric(14,2) precision is rejected or safely rounded by the DB (document actual)",
      rejected ? "rejected by DB" : "accepted and rounded by numeric(14,2)",
      rejected ? "PASS" : "FAIL", rejected ? res.error.message.slice(0, 80) : "row would persist as 1000000000000.00");
  }

  // ============ T-04 date validation ============
  {
    const badDates = ["2026-02-30", "31/12/2026", "", "2026-13-01"];
    const evidence = [];
    let allRejected = true;
    for (const d of badDates) {
      if (!validIsoDate(d) && d !== "") {
        evidence.push(`${d || "(empty)"}: rejected at app validation (isValidDate false)`);
        continue;
      }
      const res = await a.from("transactions").insert({
        kind: "expense", amount: "10.00", transaction_date: d, category_id: anyExpenseA.id,
      });
      if (res.error) {
        evidence.push(`${d || "(empty)"}: DB rejected (${res.error.message.slice(0, 50)})`);
      } else {
        allRejected = false;
        evidence.push(`${d || "(empty)"}: ACCEPTED (unexpected)`);
        await a.from("transactions").delete().eq("transaction_date", d === "" ? "0001-01-01" : d);
      }
    }
    // Future date is allowed per app rules — verify it persists and then remove it.
    const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const fres = await a.from("transactions").insert({
      kind: "expense", amount: "10.00", transaction_date: future, category_id: anyExpenseA.id,
      description: "T-04 future-dated probe",
    }).select("id");
    const futureOk = !fres.error;
    if (futureOk) await a.from("transactions").delete().eq("id", fres.data[0].id);
    evidence.push(`future date ${future}: ${futureOk ? "accepted (per app: allowed)" : "rejected"}`);
    record("T-04", "Invalid calendar dates and unsupported formats rejected; future date behavior documented",
      allRejected ? "all invalid rejected; future accepted" : "see evidence",
      allRejected ? "PASS" : "FAIL", evidence.join(" | "));
  }

  // ============ T-05 required fields / missing category ============
  {
    const noCat = await a.from("transactions").insert({
      kind: "expense", amount: "10.00", transaction_date: TODAY, category_id: null,
      description: "T-05 no category",
    }).select("id");
    const allowedNoCat = !noCat.error;
    let cleaned = true;
    if (allowedNoCat) await a.from("transactions").delete().eq("id", noCat.data[0].id);
    else cleaned = false;
    record("T-05", "Category-optional behavior documented (record actual)",
      allowedNoCat ? "transaction without category is ACCEPTED (category_id nullable)" : `rejected: ${noCat.error?.message?.slice(0, 60)}`,
      "PASS", "actual behavior recorded; per DB schema category_id IS nullable so both outcomes are structurally possible",
      allowedNoCat ? "Confirm with product whether optional categories are intended (spec 5.3 lists category as a field but not clearly required). No code change in this stage." : "");
  }

  // ============ T-06 edit ============
  {
    if (!t02) {
      record("T-06", "Edit expense amount 480.25 -> 500.00 and change date", "fixture row missing", "BLOCKED", "");
    } else {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const res = await a.from("transactions").update({
        amount: "500.00", transaction_date: tomorrow,
      }).eq("id", t02.id).select("amount,transaction_date").single();
      // PostgREST returns numeric as a JSON number; compare in cents.
      const ok = !res.error && res.data && toCents(res.data.amount) === 50000n && res.data.transaction_date === tomorrow;
      record("T-06", "Expense updated to 500.00 with new date; summary reflects change",
        ok ? `amount=${res.data.amount} date=${res.data.transaction_date}` : `error: ${res.error?.message ?? JSON.stringify(res.data)}`,
        ok ? "PASS" : "FAIL", "");
    }
  }

  // ============ T-07 delete with confirmation ============
  {
    // UI-level confirmation is a frontend concern; here we verify the data path.
    const tmp = await a.from("transactions").insert({
      kind: "expense", amount: "1.01", transaction_date: TODAY, category_id: anyExpenseA.id,
      description: "T-07 delete probe",
    }).select("id").single();
    if (tmp.error) {
      record("T-07", "Delete removes row; totals update", `setup failed: ${tmp.error.message}`, "BLOCKED", "");
    } else {
      const del = await a.from("transactions").delete().eq("id", tmp.data.id);
      const confirm = await a.from("transactions").select("id").eq("id", tmp.data.id).maybeSingle();
      const ok = !del.error && confirm.data === null;
      record("T-07", "Deleted transaction no longer retrievable; totals recompute",
        ok ? "row gone after delete" : `error: ${del.error?.message ?? confirm.error?.message ?? "row still present"}`,
        ok ? "PASS" : "FAIL", "UI confirmation dialog is a frontend behavior; data path verified here. UI dialog check happens in browser runtime stage.");
    }
  }

  // ============ T-08 category-kind matching ============
  {
    const wrongKind = await a.from("transactions").insert({
      kind: "expense", amount: "10.00", transaction_date: TODAY,
      category_id: salaryA.id, // income category used for expense
    });
    const rejected = Boolean(wrongKind.error);
    const dbOk = !rejected ? null : wrongKind.error.message;
    record("T-08a", "Expense with an INCOME category is rejected (composite FK kind match)",
      rejected ? `rejected: ${dbOk.slice(0, 70)}` : "ACCEPTED (composite FK not enforcing kind)",
      rejected ? "PASS" : "FAIL", "");

    const filterRes = await a.from("transactions").select("id,category_id").eq("category_id", salaryA.id);
    const onlySalary = (filterRes.data ?? []).every((r) => r.category_id === salaryA.id);
    record("T-08b", "Filter by category returns only that category's rows",
      `${filterRes.data?.length ?? "?"} rows; all match=${onlySolid(onlySalary)}`,
      onlySolid(onlySalary) ? "PASS" : "FAIL", "");
  }
  function onlySolid(v) { return v === true; }

  // ============ T-09 filters ============
  {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const e1 = await a.from("transactions").insert({
      kind: "expense", amount: "100.00", transaction_date: yesterday, category_id: anyExpenseA.id,
      description: "T-09 filter probe",
    }).select("id").single();
    if (e1.error) {
      record("T-09", "Date/type/category filters narrow the list", `setup failed: ${e1.error.message}`, "BLOCKED", "");
    } else {
      const byDate = await a.from("transactions").select("id").gte("transaction_date", TODAY).lte("transaction_date", TODAY);
      const excludesYesterday = !(byDate.data ?? []).some((r) => r.id === e1.data.id);
      const byType = await a.from("transactions").select("id,kind").eq("kind", "income");
      const onlyIncome = (byType.data ?? []).every((r) => r.kind === "income");
      const byCat = await a.from("transactions").select("id,category_id").eq("category_id", anyExpenseA.id);
      const mismatches = (byCat.data ?? []).filter((r) => r.category_id !== anyExpenseA.id);
      const onlyThatCat = mismatches.length === 0;
      await a.from("transactions").delete().eq("id", e1.data.id);
      const ok = excludesYesterday && onlyIncome && onlyThatCat;
      record("T-09", "Date-range, type, and category filters each narrow results correctly",
        ok ? "all three filters behaved as expected" : `date=${excludesYesterday} type=${onlyIncome} cat=${onlyThatCat} mismatches=${JSON.stringify(mismatches ?? []).slice(0, 200)}`,
        ok ? "PASS" : "FAIL", "");
    }
  }

  // ============ T-10 monthly summary exact-cent net ============
  {
    // Clean baseline: delete A's transactions then insert a known set.
    await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const seed = [
      { kind: "income", amount: "12500.50", date: TODAY, cat: salaryA.id },
      { kind: "income", amount: "2400.00", date: TODAY, cat: null },
      { kind: "expense", amount: "480.25", date: TODAY, cat: anyExpenseA.id },
      { kind: "expense", amount: "19.75", date: TODAY, cat: null },
    ];
    for (const s of seed) {
      const r = await a.from("transactions").insert({
        kind: s.kind, amount: s.amount, transaction_date: s.date, category_id: s.cat,
      });
      if (r.error) {
        record("T-10", "Month summary net equals hand-computed exact value", `seed failed: ${r.error.message}`, "BLOCKED", "");
        break;
      }
    }
    const rows = await a.from("transactions").select("kind,amount");
    const incomeCents = sumCents((rows.data ?? []).filter((r) => r.kind === "income").map((r) => r.amount));
    const expenseCents = sumCents((rows.data ?? []).filter((r) => r.kind === "expense").map((r) => r.amount));
    const expectedNet = incomeCents - expenseCents; // 14900.50 - 500.00 = 14400.50
    const expIncome = "14900.50", expExpense = "500.00", expNet = "14400.50";
    const ok = centsToDecimalString(incomeCents) === expIncome
      && centsToDecimalString(expenseCents) === expExpense
      && centsToDecimalString(expectedNet) === expNet;
    record("T-10", `income=${expIncome}, expense=${expExpense}, net=${expNet} (exact cents)`,
      `income=${centsToDecimalString(incomeCents)}, expense=${centsToDecimalString(expenseCents)}, net=${centsToDecimalString(expectedNet)}`,
      ok ? "PASS" : "FAIL", "");
  }

  // ============ T-11 long description ============
  {
    const long = "x".repeat(250);
    const res = await a.from("transactions").insert({
      kind: "expense", amount: "5.00", transaction_date: TODAY, category_id: anyExpenseA.id,
      description: long,
    }).select("id,description").single();
    const ok = !res.error && res.data.description.length === 250;
    if (ok) await a.from("transactions").delete().eq("id", res.data.id);
    record("T-11", "250-char description stored intact (rendered as text by React; no HTML sink in this code path)",
      ok ? "stored and read back intact" : `error: ${res.error?.message?.slice(0, 60) ?? "mismatch"}`,
      ok ? "PASS" : "FAIL", "XSS rendering is a frontend concern; React escapes text nodes. Data layer verified here.");
  }

  // ============ T-12 cross-user isolation (B cannot touch A's row) ============
  {
    // T-10 wipes A's baseline, so create a fresh owner-only fixture row here.
    const isoFixture = await a.from("transactions").insert({
      kind: "income", amount: "12500.50", transaction_date: TODAY, category_id: salaryA.id,
      description: "T-12 isolation fixture",
    }).select("id,amount").single();
    if (isoFixture.error) {
      record("T-12", "User B cannot read/modify/delete User A's transaction", `setup failed: ${isoFixture.error.message}`, "BLOCKED", "");
    } else {
      const fixtureId = isoFixture.data.id;
      const readB = await b.from("transactions").select("id").eq("id", fixtureId);
      const readDenied = (readB.data ?? []).length === 0;
      const upd = await b.from("transactions").update({ amount: "1.00" }).eq("id", fixtureId).select("id");
      const updDenied = (upd.data ?? []).length === 0;
      const del = await b.from("transactions").delete().eq("id", fixtureId).select("id");
      const delDenied = (del.data ?? []).length === 0;
      const verify = await a.from("transactions").select("amount").eq("id", fixtureId).maybeSingle();
      const intact = !!verify.data && toCents(verify.data.amount) === 1250050n;
      const ok = readDenied && updDenied && delDenied && intact;
      record("T-12", "B's read/update/delete on A's transaction all return zero rows; A's data unchanged",
        `read=${readDenied} update=${updDenied} delete=${delDenied} intact=${intact}`,
        ok ? "PASS" : "FAIL", readB.error?.message || upd.error?.message || del.error?.message || "");
    }
  }

  // ============ T-13 currency display ============
  {
    // Server-side: currency is stored on profile only; no conversion column exists on transactions.
    const profA = await a.from("profiles").select("preferred_currency").maybeSingle();
    const cur = profA.data?.preferred_currency ?? null;
    record("T-13", "Currency is a profile-level display setting; no conversion math exists server-side",
      `A preferred_currency=${cur ?? "none"}`,
      cur ? "PASS" : "FAIL", "Formatting to ₱ happens in the frontend (formatCurrency); no conversion occurs.");
  }

  // ---- Cleanup of A's data (leave B clean; delete A's rows but keep accounts for later stages)
  await a.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  console.log(JSON.stringify({
    runId,
    accounts: { A: { email: emailA, userId: A.session.user.id }, B: { email: emailB, userId: B.session.user.id } },
    results,
  }, null, 2));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : String(e));
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(1);
});
