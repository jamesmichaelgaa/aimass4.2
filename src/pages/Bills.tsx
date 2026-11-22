import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import {
  billStatus,
  createBill,
  fetchBillPayments,
  fetchBills,
  FREQUENCY_LABELS,
  isBillFrequency,
  markOccurrencePaid,
  setBillActive,
  updateBill,
  type BillFrequency,
  type BillPayment,
  type BillStatus,
  type RecurringBill,
} from "../lib/bills";
import { fetchCategories } from "../lib/transactions";
import { formatCurrency, normalizeDateInput, parseAmountToDecimalString, type Category } from "../lib/types";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface BillFormState {
  name: string;
  amount: string;
  frequency: BillFrequency;
  dueDate: string;
  categoryId: string;
  useCustomAmount: boolean;
  customAmount: string;
  customDescription: string;
}

function emptyForm(): BillFormState {
  return {
    name: "",
    amount: "",
    frequency: "monthly",
    dueDate: todayIso(),
    categoryId: "",
    useCustomAmount: false,
    customAmount: "",
    customDescription: "",
  };
}

function formFromBill(bill: RecurringBill): BillFormState {
  return {
    name: bill.name,
    amount: bill.amount,
    frequency: bill.frequency,
    dueDate: bill.next_due_date,
    categoryId: bill.category_id ?? "",
    useCustomAmount: false,
    customAmount: "",
    customDescription: "",
  };
}

type Editor = { open: false } | { open: true; bill: RecurringBill | null };

interface PayIntent {
  bill: RecurringBill;
}

export default function Bills() {
  const { profile } = useAuth();
  const currency = profile?.preferred_currency ?? "PHP";

  const [bills, setBills] = useState<RecurringBill[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);

  const [editor, setEditor] = useState<Editor>({ open: false });
  const [form, setForm] = useState<BillFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [payIntent, setPayIntent] = useState<PayIntent | null>(null);
  const [payAmountOverride, setPayAmountOverride] = useState("");
  const [payUseOverride, setPayUseOverride] = useState(false);
  const [payDescription, setPayDescription] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const [deactivateTarget, setDeactivateTarget] = useState<RecurringBill | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const [historyBill, setHistoryBill] = useState<RecurringBill | null>(null);
  const [historyPayments, setHistoryPayments] = useState<BillPayment[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const reloadToken = useRef(0);

  const reload = useCallback(async () => {
    const token = ++reloadToken.current;
    const result = await fetchBills();
    if (token !== reloadToken.current) {
      return;
    }
    setBills(result.bills);
    setListError(result.error);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    fetchCategories().then((result) => {
      if (cancelled || result.error) {
        return;
      }
      setExpenseCategories([...result.expense].sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function openAdd() {
    setForm(emptyForm());
    setFormError(null);
    setEditor({ open: true, bill: null });
    setNotice(null);
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }

  function openEdit(bill: RecurringBill) {
    setForm(formFromBill(bill));
    setFormError(null);
    setEditor({ open: true, bill });
    setNotice(null);
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }

  function closeEditor() {
    setEditor({ open: false });
  }

  function validateBillForm(): { name: string; amount: string; frequency: BillFrequency; nextDueDate: string; categoryId: string | null } | { error: string } {
    const name = form.name.replace(/\s+/g, " ").trim();
    if (name === "") {
      return { error: "Enter a bill name." };
    }
    if (name.length > 80) {
      return { error: "Keep the bill name under 80 characters." };
    }
    const amount = parseAmountToDecimalString(form.amount);
    if (!amount) {
      return { error: "Enter an amount greater than zero, with up to two decimals (for example 1200 or 1200.50)." };
    }
    const dueDate = normalizeDateInput(form.dueDate);
    if (!dueDate) {
      return { error: "Enter a valid next due date." };
    }
    if (form.categoryId && !expenseCategories.some((c) => c.id === form.categoryId)) {
      return { error: "Pick a valid expense category for the bill." };
    }
    return { name, amount, frequency: form.frequency, nextDueDate: dueDate, categoryId: form.categoryId || null };
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (saving || !editor.open) {
      return;
    }
    setFormError(null);
    const input = validateBillForm();
    if ("error" in input) {
      setFormError(input.error);
      return;
    }
    setSaving(true);
    const result = editor.bill
      ? await updateBill(editor.bill.id, input)
      : await createBill(input);
    setSaving(false);
    if (result.error) {
      setFormError(result.error);
      return;
    }
    closeEditor();
    setNotice({ kind: "success", text: editor.bill ? "Bill updated." : "Bill added." });
    void reload();
  }

  function openPayDialog(bill: RecurringBill) {
    setPayIntent({ bill });
    setPayUseOverride(false);
    setPayAmountOverride("");
    setPayDescription("");
    setPayError(null);
  }

  async function handleConfirmPay() {
    if (!payIntent || paying) {
      return;
    }
    setPayError(null);
    // Without the override tick, the bill's own amount is used — the RPC
    // requires a positive amount (or a linked transaction), so it is always sent.
    let amountOverride: string | null = payIntent.bill.amount;
    if (payUseOverride) {
      const parsed = parseAmountToDecimalString(payAmountOverride);
      if (!parsed) {
        setPayError("Enter an amount actually paid, greater than zero, with up to two decimals.");
        return;
      }
      amountOverride = parsed;
    }
    setPaying(true);
    const result = await markOccurrencePaid(payIntent.bill.id, payIntent.bill.next_due_date, {
      categoryId: payIntent.bill.category_id,
      description: payIntent.bill.name,
      amountOverride,
    });
    setPaying(false);
    if (result.error) {
      setPayError(result.error);
      void reload();
      return;
    }
    setPayIntent(null);
    setNotice({ kind: "success", text: "Payment recorded — an expense was added and the due date moved forward." });
    void reload();
  }

  async function handleDeactivate() {
    if (!deactivateTarget || deactivating) {
      return;
    }
    setDeactivating(true);
    const result = await setBillActive(deactivateTarget.id, false);
    setDeactivating(false);
    setDeactivateTarget(null);
    if (result.error) {
      setNotice({ kind: "error", text: result.error });
    } else {
      setNotice({ kind: "success", text: "Bill deactivated. It no longer appears as upcoming, and its history is kept." });
    }
    void reload();
  }

  function openHistory(bill: RecurringBill) {
    setHistoryBill(bill);
    setHistoryPayments(null);
    setHistoryError(null);
    void fetchBillPayments(bill.id).then((result) => {
      setHistoryPayments(result.payments);
      setHistoryError(result.error);
    });
  }

  const today = todayIso();
  const grouped = useMemo(() => {
    const all = bills ?? [];
    const sortKey = (b: RecurringBill) => b.next_due_date;
    return {
      overdue: all.filter((b) => billStatus(b, today) === "overdue").sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      dueToday: all.filter((b) => billStatus(b, today) === "due-today"),
      upcoming: all.filter((b) => billStatus(b, today) === "upcoming").sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      inactive: all.filter((b) => billStatus(b, today) === "inactive").sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    };
  }, [bills, today]);

  const hasAnyBills = bills !== null && bills.length > 0;

  function renderBillRow(bill: RecurringBill, status: BillStatus) {
    return (
      <div key={bill.id} className="bill-row">
        <div className="bill-main">
          <span className="bill-name">{bill.name}</span>
          <span className="bill-meta">
            {formatCurrency(bill.amount, currency)} · {FREQUENCY_LABELS[bill.frequency]}
            {bill.category_name ? ` · ${bill.category_name}` : ""}
          </span>
        </div>
        <div className="bill-side">
          <span className={`bill-due ${status}`}>
            {status === "overdue"
              ? `Overdue — was due ${bill.next_due_date}`
              : status === "due-today"
                ? "Due today"
                : `Next due ${bill.next_due_date}`}
          </span>
          <div className="tx-item-actions">
            {bill.is_active && (
              <button className="button button-primary button-sm" onClick={() => openPayDialog(bill)}>
                Mark paid
              </button>
            )}
            <button className="button button-secondary button-sm" onClick={() => openEdit(bill)}>
              Edit
            </button>
            <button className="button button-secondary button-sm" onClick={() => openHistory(bill)}>
              History
            </button>
            {bill.is_active ? (
              <button className="button button-danger button-sm" onClick={() => setDeactivateTarget(bill)}>
                Deactivate
              </button>
            ) : (
              <span className="badge">Inactive</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <div className="tx-page-head">
        <h1>Bills</h1>
        <button className="button button-primary" onClick={openAdd}>
          + Add bill
        </button>
      </div>

      {notice && (
        <div className={`alert alert-${notice.kind === "success" ? "success" : "error"}`} role="status">
          {notice.text}
        </div>
      )}

      {editor.open && (
        <div className="card">
          <h2 ref={headingRef} tabIndex={-1}>
            {editor.bill ? "Edit bill" : "New bill"}
          </h2>
          <form className="form-grid" onSubmit={handleSave} noValidate>
            {formError && (
              <div className="alert alert-error" role="alert">
                {formError}
              </div>
            )}
            <div className="field-row">
              <div className="field">
                <label htmlFor="bill-name">Bill name</label>
                <input
                  id="bill-name"
                  className="input"
                  type="text"
                  maxLength={80}
                  placeholder="e.g. Electricity"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="bill-amount">Amount ({currency})</label>
                <input
                  id="bill-amount"
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 1200.00"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="bill-frequency">Frequency</label>
                <select
                  id="bill-frequency"
                  className="select"
                  value={form.frequency}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (isBillFrequency(value)) {
                      setForm((prev) => ({ ...prev, frequency: value }));
                    }
                  }}
                >
                  {(Object.keys(FREQUENCY_LABELS) as BillFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="bill-due">Next due date</label>
                <input
                  id="bill-due"
                  className="input"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="bill-category">Category (optional)</label>
              <select
                id="bill-category"
                className="select"
                value={form.categoryId}
                onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
              >
                <option value="">No category</option>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="hint">The expense recorded when you pay the bill will use this category.</span>
            </div>
            <div className="onboarding-actions" style={{ marginTop: 8 }}>
              <button type="button" className="button button-secondary" onClick={closeEditor} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? "Saving…" : editor.bill ? "Save changes" : "Add bill"}
              </button>
            </div>
          </form>
        </div>
      )}

      {bills === null && !listError && <div className="spinner" role="status" aria-label="Loading bills" />}
      {listError && (
        <div className="alert alert-error" role="alert">
          {listError}
        </div>
      )}
      {bills !== null && !listError && !hasAnyBills && (
        <div className="card">
          <div className="empty-state">
            <p>
              No bills yet. Add recurring bills like rent, utilities, or subscriptions — aimass will remind you in-app
              when each one is coming due, and recording a payment creates the expense for you.
            </p>
          </div>
        </div>
      )}

      {bills !== null && !listError && hasAnyBills && (
        <>
          {(grouped.overdue.length > 0 || grouped.dueToday.length > 0) && (
            <div className="card">
              <h2>Needs attention</h2>
              {grouped.overdue.map((b) => renderBillRow(b, "overdue"))}
              {grouped.dueToday.map((b) => renderBillRow(b, "due-today"))}
            </div>
          )}
          {grouped.upcoming.length > 0 && (
            <div className="card">
              <h2>Upcoming</h2>
              {grouped.upcoming.map((b) => renderBillRow(b, "upcoming"))}
            </div>
          )}
          {grouped.inactive.length > 0 && (
            <div className="card">
              <h2>Inactive bills</h2>
              <p className="section-note">Deactivated bills keep their payment history but no longer generate reminders.</p>
              {grouped.inactive.map((b) => renderBillRow(b, "inactive"))}
            </div>
          )}
        </>
      )}

      {payIntent && (
        <div className="modal-overlay" role="presentation">
          <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="pay-title">
            <h2 id="pay-title">Mark “{payIntent.bill.name}” as paid?</h2>
            <p className="section-note">
              This records an expense of {formatCurrency(payIntent.bill.amount, currency)}
              {payIntent.bill.category_name ? ` in ${payIntent.bill.category_name}` : ""} dated{" "}
              {payIntent.bill.next_due_date}, then moves the next due date forward.
            </p>
            {payError && (
              <div className="alert alert-error" role="alert">
                {payError}
              </div>
            )}
            <div className="field">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={payUseOverride}
                  onChange={(e) => setPayUseOverride(e.target.checked)}
                />{" "}
                The amount paid differs from the bill amount
              </label>
            </div>
            {payUseOverride && (
              <div className="field">
                <label htmlFor="pay-amount">Amount actually paid ({currency})</label>
                <input
                  id="pay-amount"
                  className="input"
                  type="text"
                  inputMode="decimal"
                  value={payAmountOverride}
                  onChange={(e) => setPayAmountOverride(e.target.value)}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="pay-description">Expense description</label>
              <input
                id="pay-description"
                className="input"
                type="text"
                maxLength={280}
                value={payDescription}
                onChange={(e) => setPayDescription(e.target.value)}
                placeholder={`Defaults to "${payIntent.bill.name}"`}
              />
            </div>
            <div className="onboarding-actions" style={{ marginTop: 8 }}>
              <button className="button button-secondary" onClick={() => setPayIntent(null)} disabled={paying}>
                Cancel
              </button>
              <button className="button button-primary" onClick={() => void handleConfirmPay()} disabled={paying}>
                {paying ? "Recording…" : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deactivateTarget && (
        <div className="modal-overlay" role="presentation">
          <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="deactivate-title">
            <h2 id="deactivate-title">Deactivate “{deactivateTarget.name}”?</h2>
            <p className="center-note" style={{ textAlign: "left", padding: "4px 0 16px" }}>
              Bills with payment history are never deleted, so your records stay intact. A deactivated bill stops
              generating reminders and can't be marked paid until reactivated.
            </p>
            <div className="onboarding-actions" style={{ marginTop: 0 }}>
              <button className="button button-secondary" onClick={() => setDeactivateTarget(null)} disabled={deactivating}>
                Cancel
              </button>
              <button className="button button-danger" onClick={() => void handleDeactivate()} disabled={deactivating}>
                {deactivating ? "Deactivating…" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyBill && (
        <div className="modal-overlay" role="presentation">
          <div className="modal modal-wide card" role="dialog" aria-modal="true" aria-labelledby="history-title">
            <h2 id="history-title">Payment history — {historyBill.name}</h2>
            {historyError && (
              <div className="alert alert-error" role="alert">
                {historyError}
              </div>
            )}
            {historyPayments === null && !historyError && (
              <div className="spinner" role="status" aria-label="Loading payment history" />
            )}
            {historyPayments !== null && !historyError && historyPayments.length === 0 && (
              <p className="center-note">No payments recorded yet for this bill.</p>
            )}
            {historyPayments !== null && !historyError && historyPayments.length > 0 && (
              <div className="tx-list">
                {historyPayments.map((p) => (
                  <div key={p.id} className="tx-item">
                    <div className="tx-item-main">
                      <span className="tx-amount expense">−{formatCurrency(p.amount, currency)}</span>
                      <span className="tx-desc">{p.description ?? "(no description)"}</span>
                      <span className="tx-meta">
                        Due {p.due_date}
                        {p.transaction_date && p.transaction_date !== p.due_date ? ` · paid ${p.transaction_date}` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button className="button button-secondary" onClick={() => setHistoryBill(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
