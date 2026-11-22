import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import {
  createTransaction,
  deleteTransaction,
  fetchCategories,
  fetchMonthSummary,
  fetchTransactions,
  updateTransaction,
  type TransactionFilters,
  type TransactionInput,
} from "../lib/transactions";
import {
  formatCurrency,
  getMonthMeta,
  monthRange,
  normalizeDateInput,
  parseAmountToDecimalString,
  type Category,
  type Summary,
  type TransactionKind,
  type TransactionRow,
} from "../lib/types";

type EditorMode = { open: false } | { open: true; editing: TransactionRow | null };

interface FormState {
  kind: TransactionKind;
  amount: string;
  date: string;
  categoryId: string;
  description: string;
}

function emptyForm(kind: TransactionKind = "expense"): FormState {
  return { kind, amount: "", date: new Date().toISOString().slice(0, 10), categoryId: "", description: "" };
}

function formFromRow(row: TransactionRow): FormState {
  return {
    kind: row.kind,
    amount: row.amount,
    date: row.transaction_date,
    categoryId: row.category_id ?? "",
    description: row.description ?? "",
  };
}

export default function Transactions() {
  const { profile } = useAuth();
  const currency = profile?.preferred_currency ?? "PHP";

  const meta = useMemo(() => getMonthMeta(), []);
  const [filters, setFilters] = useState<TransactionFilters>(() => {
    const range = monthRange(meta.ym);
    return { from: range.start, to: range.end, kind: null, categoryId: null };
  });

  const [rows, setRows] = useState<TransactionRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ income: Category[]; expense: Category[] } | null>(null);

  const [editor, setEditor] = useState<EditorMode>({ open: false });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const editorHeadingRef = useRef<HTMLHeadingElement>(null);
  const reloadToken = useRef(0);

  const reload = useCallback(async () => {
    const token = ++reloadToken.current;
    setRowsError(null);
    setSummaryError(null);
    const [txResult, summaryResult] = await Promise.all([
      fetchTransactions(filters),
      filters.from && filters.to
        ? fetchMonthSummary(filters.from, filters.to)
        : Promise.resolve({ income: "0.00", expense: "0.00", net: "0.00" } satisfies Summary),
    ]);
    if (token !== reloadToken.current) {
      return;
    }
    if ("error" in summaryResult) {
      setSummary(null);
      setSummaryError(summaryResult.error);
    } else {
      setSummary(summaryResult);
      setSummaryError(null);
    }
    setRows(txResult.rows);
    setRowsError(txResult.error);
  }, [filters]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    fetchCategories().then((result) => {
      if (cancelled) {
        return;
      }
      setCategories({ income: result.income, expense: result.expense });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function openAdd(kind: TransactionKind) {
    setForm(emptyForm(kind));
    setFormError(null);
    setEditor({ open: true, editing: null });
    setNotice(null);
    window.setTimeout(() => editorHeadingRef.current?.focus(), 0);
  }

  function openEdit(row: TransactionRow) {
    setForm(formFromRow(row));
    setFormError(null);
    setEditor({ open: true, editing: row });
    setNotice(null);
    window.setTimeout(() => editorHeadingRef.current?.focus(), 0);
  }

  function closeEditor() {
    setEditor({ open: false });
  }

  function validate(): TransactionInput | { error: string } {
    const amount = parseAmountToDecimalString(form.amount);
    if (!amount) {
      return { error: "Enter an amount greater than zero, with up to two decimals (for example 250 or 250.75)." };
    }
    const date = normalizeDateInput(form.date);
    if (!date) {
      return { error: "Enter a valid date, for example 11/22/2026 or 2026-11-22." };
    }
    const pool = form.kind === "income" ? categories?.income ?? [] : categories?.expense ?? [];
    if (form.categoryId && !pool.some((c) => c.id === form.categoryId)) {
      return { error: `Pick a category that matches the transaction type (${form.kind}).` };
    }
    return {
      kind: form.kind,
      amount,
      transactionDate: date,
      categoryId: form.categoryId || null,
      description: form.description.trim() === "" ? null : form.description.trim(),
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) {
      return;
    }
    setFormError(null);
    const input = validate();
    if ("error" in input) {
      setFormError(input.error);
      return;
    }
    setSaving(true);
    const editing = editor.open ? editor.editing : null;
    const isEdit = editing !== null;
    const result = isEdit ? await updateTransaction(editing.id, input) : await createTransaction(input);
    setSaving(false);
    if (result.error) {
      setFormError(result.error);
      return;
    }
    closeEditor();
    setNotice({ kind: "success", text: isEdit ? "Transaction updated." : "Transaction added." });
    void reload();
  }

  async function handleDelete() {
    if (!confirmDeleteId || deleting) {
      return;
    }
    setDeleting(true);
    const result = await deleteTransaction(confirmDeleteId);
    setDeleting(false);
    setConfirmDeleteId(null);
    if (result.error) {
      setNotice({ kind: "error", text: result.error });
    } else {
      setNotice({ kind: "success", text: "Transaction deleted." });
    }
    void reload();
  }

  const filterableCategories = useMemo(() => {
    if (!categories) {
      return [];
    }
    const pool = filters.kind ? (filters.kind === "income" ? categories.income : categories.expense) : [...categories.income, ...categories.expense];
    return [...pool].sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, filters.kind]);

  function setFilter(patch: Partial<TransactionFilters>) {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      if (patch.kind !== undefined && prev.kind !== patch.kind && next.categoryId) {
        const pool = patch.kind === null ? [...(categories?.income ?? []), ...(categories?.expense ?? [])] : patch.kind === "income" ? categories?.income ?? [] : categories?.expense ?? [];
        if (!pool.some((c) => c.id === next.categoryId)) {
          next.categoryId = null;
        }
      }
      return next;
    });
  }

  function clearFilters() {
    const range = monthRange(meta.ym);
    setFilters({ from: range.start, to: range.end, kind: null, categoryId: null });
  }

  const hasActiveFilters =
    filters.kind !== null || filters.categoryId !== null || filters.from !== monthRange(meta.ym).start || filters.to !== monthRange(meta.ym).end;

  const editingTitle = editor.open ? (editor.editing ? "Edit transaction" : "New transaction") : "";

  return (
    <div className="dashboard-grid">
      <div className="tx-page-head">
        <h1>Transactions</h1>
        <div className="tx-page-actions">
          <button className="button button-secondary" onClick={() => openAdd("income")}>
            + Add income
          </button>
          <button className="button button-primary" onClick={() => openAdd("expense")}>
            + Add expense
          </button>
        </div>
      </div>

      {notice && (
        <div className={`alert alert-${notice.kind === "success" ? "success" : "error"}`} role="status">
          {notice.text}
        </div>
      )}

      {editor.open && (
        <div className="card">
          <h2 ref={editorHeadingRef} tabIndex={-1}>
            {editingTitle}
          </h2>
          <form className="form-grid" onSubmit={handleSubmit} noValidate>
            {formError && (
              <div className="alert alert-error" role="alert">
                {formError}
              </div>
            )}
            <div className="field">
              <span className="field-label" id="tx-kind-label">
                Type
              </span>
              <div className="radio-cards" role="radiogroup" aria-labelledby="tx-kind-label">
                {(["expense", "income"] as TransactionKind[]).map((kind) => (
                  <label key={kind} className={`radio-card ${form.kind === kind ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="tx-kind"
                      value={kind}
                      checked={form.kind === kind}
                      onChange={() => {
                        setForm((prev) => ({ ...prev, kind, categoryId: "" }));
                      }}
                    />
                    <span className="title">{kind === "income" ? "Income" : "Expense"}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="tx-amount">Amount ({currency})</label>
                <input
                  id="tx-amount"
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 250.75"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="tx-date">Date</label>
                <input
                  id="tx-date"
                  className="input"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="tx-category">Category (optional)</label>
              <select
                id="tx-category"
                className="select"
                value={form.categoryId}
                onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
              >
                <option value="">No category</option>
                {(form.kind === "income" ? categories?.income ?? [] : categories?.expense ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="hint">Only {form.kind} categories are listed.</span>
            </div>
            <div className="field">
              <label htmlFor="tx-description">Description (optional)</label>
              <input
                id="tx-description"
                className="input"
                type="text"
                maxLength={280}
                placeholder="e.g. Grocery run"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="onboarding-actions" style={{ marginTop: 8 }}>
              <button type="button" className="button button-secondary" onClick={closeEditor} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? "Saving…" : editor.editing ? "Save changes" : "Add transaction"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="summary-row">
        <div className="card stat-card">
          <h3>Income in range</h3>
          {summaryError ? <div className="value">—</div> : <div className="value">{formatCurrency(summary?.income ?? "0", currency)}</div>}
          <div className="sub">{summaryError ?? "Total of income records in the selected range."}</div>
        </div>
        <div className="card stat-card">
          <h3>Expenses in range</h3>
          {summaryError ? <div className="value">—</div> : <div className="value">{formatCurrency(summary?.expense ?? "0", currency)}</div>}
          <div className="sub">{summaryError ?? "Total of expense records in the selected range."}</div>
        </div>
        <div className="card stat-card">
          <h3>Net cash flow</h3>
          {summaryError ? (
            <div className="value">—</div>
          ) : (
            <div className={`value ${summary && summary.net.startsWith("-") ? "net-negative" : "net-positive"}`}>
              {formatCurrency(summary?.net ?? "0", currency)}
            </div>
          )}
          <div className="sub">{summaryError ?? "Income minus expenses for the selected range."}</div>
        </div>
      </div>

      <div className="card">
        <h2>Filters</h2>
        <form
          className="filters-grid"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input
              id="f-from"
              className="input"
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setFilter({ from: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input
              id="f-to"
              className="input"
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setFilter({ to: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label htmlFor="f-kind">Type</label>
            <select
              id="f-kind"
              className="select"
              value={filters.kind ?? ""}
              onChange={(e) => setFilter({ kind: e.target.value === "" ? null : (e.target.value as TransactionKind) })}
            >
              <option value="">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-category">Category</label>
            <select
              id="f-category"
              className="select"
              value={filters.categoryId ?? ""}
              onChange={(e) => setFilter({ categoryId: e.target.value || null })}
            >
              <option value="">All categories</option>
              {filterableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.kind})
                </option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <div className="field">
              <button type="button" className="button button-secondary" onClick={clearFilters}>
                Reset
              </button>
            </div>
          )}
        </form>
      </div>

      <div className="card">
        <h2>History</h2>
        {rows === null && !rowsError && (
          <div className="spinner" role="status" aria-label="Loading transactions" />
        )}
        {rowsError && (
          <div className="alert alert-error" role="alert">
            {rowsError}
          </div>
        )}
        {rows !== null && !rowsError && rows.length === 0 && (
          <div className="empty-state">
            <p>
              {hasActiveFilters
                ? "No transactions match these filters. Try widening the date range or clearing filters."
                : "No transactions yet for this range. Use “Add income” or “Add expense” to record your first one."}
            </p>
          </div>
        )}
        {rows !== null && !rowsError && rows.length > 0 && (
          <div className="tx-list">
            {rows.map((row) => (
              <div key={row.id} className="tx-item">
                <div className="tx-item-main">
                  <span className={`tx-amount ${row.kind === "income" ? "income" : "expense"}`}>
                    {row.kind === "income" ? "+" : "−"}
                    {formatCurrency(row.amount, currency)}
                  </span>
                  <span className="tx-desc">{row.description ?? "(no description)"}</span>
                  <span className="tx-meta">
                    {row.transaction_date}
                    {row.category_name ? ` · ${row.category_name}` : ""}
                  </span>
                </div>
                <div className="tx-item-actions">
                  <button className="button button-secondary button-sm" onClick={() => openEdit(row)}>
                    Edit
                  </button>
                  <button className="button button-danger button-sm" onClick={() => setConfirmDeleteId(row.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <div className="modal-overlay" role="presentation">
          <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
            <h2 id="delete-title">Delete this transaction?</h2>
            <p className="center-note" style={{ textAlign: "left", padding: "4px 0 16px" }}>
              This permanently removes the record and its totals will change.
            </p>
            <div className="onboarding-actions" style={{ marginTop: 0 }}>
              <button className="button button-secondary" onClick={() => setConfirmDeleteId(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="button button-danger" onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
