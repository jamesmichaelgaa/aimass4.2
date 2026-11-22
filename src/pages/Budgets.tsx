import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import {
  budgetStatus,
  buildMonthOptions,
  categoriesForBudgetPicker,
  computeProgress,
  deleteBudget,
  fetchBudgets,
  fetchExpenseTotals,
  isCurrentMonth,
  monthBounds,
  saveBudget,
  type BudgetWithProgress,
  type MonthOption,
} from "../lib/budgets";
import { fetchCategories } from "../lib/transactions";
import { formatCurrency, parseAmountToDecimalString, type Category } from "../lib/types";

type Editor =
  | { open: false }
  | { open: true; mode: "overall"; id: string | null; monthYm: string; limit: string }
  | { open: true; mode: "category"; id: string | null; monthYm: string; limit: string; categoryId: string };

export default function Budgets() {
  const { profile } = useAuth();
  const currency = profile?.preferred_currency ?? "PHP";

  const months = useMemo(() => buildMonthOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const [expenseCategories, setExpenseCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<BudgetWithProgress[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [editor, setEditor] = useState<Editor>({ open: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<BudgetWithProgress | null>(null);
  const [deleting, setDeleting] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const loadToken = useRef(0);

  const reload = useCallback(async () => {
    const token = ++loadToken.current;
    setListError(null);
    const range = monthBounds(selectedMonth);
    const [budgetResult, expenseResult] = await Promise.all([
      fetchBudgets(selectedMonth),
      fetchExpenseTotals(range.start, range.end),
    ]);
    if (token !== loadToken.current) {
      return;
    }
    if (budgetResult.error || expenseResult.error) {
      setRows(null);
      setListError(budgetResult.error ?? expenseResult.error);
      return;
    }
    setRows(computeProgress(budgetResult.budgets, expenseResult));
  }, [selectedMonth]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    fetchCategories().then((result) => {
      if (cancelled || result.error) {
        return;
      }
      setExpenseCategories(categoriesForBudgetPicker(result.expense));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function openOverallEditor(existing: BudgetWithProgress | null) {
    setFormError(null);
    setEditor({
      open: true,
      mode: "overall",
      id: existing ? existing.id : null,
      monthYm: selectedMonth,
      limit: existing ? existing.limit_amount : "",
    });
    setNotice(null);
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }

  function openCategoryEditor(existing: BudgetWithProgress | null, presetCategoryId = "") {
    setFormError(null);
    setEditor({
      open: true,
      mode: "category",
      id: existing ? existing.id : null,
      monthYm: selectedMonth,
      limit: existing ? existing.limit_amount : "",
      categoryId: existing ? existing.category_id ?? "" : presetCategoryId,
    });
    setNotice(null);
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }

  function closeEditor() {
    setEditor({ open: false });
  }

  const budgetedCategoryIds = useMemo(
    () => new Set((rows ?? []).filter((r) => r.category_id).map((r) => r.category_id)),
    [rows]
  );

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (saving || !editor.open) {
      return;
    }
    setFormError(null);
    const amount = parseAmountToDecimalString(editor.limit);
    if (!amount) {
      setFormError("Enter an amount greater than zero, with up to two decimals (for example 5000 or 5000.50).");
      return;
    }
    if (editor.mode === "category" && !editor.categoryId) {
      setFormError("Pick a category for this budget.");
      return;
    }
    setSaving(true);
    const result = await saveBudget(
      editor.monthYm,
      editor.mode === "overall" ? null : editor.categoryId,
      amount,
      editor.id
    );
    setSaving(false);
    if (result.error) {
      setFormError(result.error);
      return;
    }
    closeEditor();
    setNotice({ kind: "success", text: editor.id ? "Budget updated." : "Budget created." });
    void reload();
  }

  async function handleDelete() {
    if (!confirmDelete || deleting) {
      return;
    }
    setDeleting(true);
    const result = await deleteBudget(confirmDelete.id);
    setDeleting(false);
    setConfirmDelete(null);
    if (result.error) {
      setNotice({ kind: "error", text: result.error });
    } else {
      setNotice({ kind: "success", text: "Budget deleted." });
    }
    void reload();
  }

  const overall = rows?.find((r) => r.category_id === null) ?? null;
  const categoryBudgets = rows?.filter((r) => r.category_id !== null) ?? [];
  const availableCategories = expenseCategories.filter((c) => !budgetedCategoryIds.has(c.id));

  function renderProgress(b: BudgetWithProgress) {
    const status = budgetStatus(b);
    const pct = Math.min(999, Math.round(b.percentUsed * 10) / 10);
    return (
      <div className="budget-progress">
        <div
          className={`budget-bar ${status}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, pct)}
          aria-label={`${b.category_name ?? "Overall"} budget used ${pct}%`}
        >
          <div className="budget-bar-fill" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="budget-figures">
          <span>
            {formatCurrency(b.spent, currency)} of {formatCurrency(b.limit_amount, currency)}
          </span>
          <span className={status === "over" ? "over-text" : status === "warning" ? "warn-text" : "ok-text"}>
            {status === "over"
              ? `${formatCurrency(spentOverBy(b), currency)} over limit`
              : `${formatCurrency(b.remaining, currency)} left · ${pct}% used`}
          </span>
        </div>
        {status === "over" && <div className="alert alert-error budget-alert">This budget is exceeded.</div>}
        {status === "warning" && <div className="alert alert-info budget-alert">Approaching the limit (80% used).</div>}
      </div>
    );
  }

  function spentOverBy(b: BudgetWithProgress): string {
    return b.remaining.startsWith("-") ? b.remaining.slice(1) : "0.00";
  }

  const editingTitle = editor.open
    ? editor.mode === "overall"
      ? editor.id
        ? "Edit overall budget"
        : "New overall budget"
      : editor.id
        ? "Edit category budget"
        : "New category budget"
    : "";

  return (
    <div className="dashboard-grid">
      <div className="tx-page-head">
        <h1>Budgets</h1>
        <div className="field budget-month-picker">
          <label htmlFor="budget-month">Month</label>
          <select
            id="budget-month"
            className="select"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {months.map((m: MonthOption) => (
              <option key={m.ym} value={m.ym}>
                {m.label}
                {isCurrentMonth(m.ym) ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {notice && (
        <div className={`alert alert-${notice.kind === "success" ? "success" : "error"}`} role="status">
          {notice.text}
        </div>
      )}

      {editor.open && (
        <div className="card">
          <h2 ref={headingRef} tabIndex={-1}>
            {editingTitle}
          </h2>
          <form className="form-grid" onSubmit={handleSave} noValidate>
            {formError && (
              <div className="alert alert-error" role="alert">
                {formError}
              </div>
            )}
            {editor.mode === "category" ? (
              <div className="field">
                <label htmlFor="budget-category">Category</label>
                {editor.id ? (
                  <input
                    id="budget-category"
                    className="input"
                    type="text"
                    value={
                      categoryBudgets.find((r) => r.id === editor.id)?.category_name ??
                      expenseCategories.find((c) => c.id === editor.categoryId)?.name ??
                      ""
                    }
                    disabled
                  />
                ) : (
                  <select
                    id="budget-category"
                    className="select"
                    value={editor.categoryId}
                    onChange={(e) => setEditor({ ...editor, categoryId: e.target.value })}
                  >
                    <option value="">Choose a category…</option>
                    {availableCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="hint">Only expense categories can have a budget.</span>
              </div>
            ) : (
              <p className="section-note" style={{ marginBottom: 0 }}>
                Overall budget for all expenses combined in {monthLabel(editor.monthYm, months)}.
              </p>
            )}
            <div className="field">
              <label htmlFor="budget-limit">Monthly limit ({currency})</label>
              <input
                id="budget-limit"
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 5000.00"
                value={editor.limit}
                onChange={(e) => setEditor({ ...editor, limit: e.target.value })}
              />
            </div>
            <div className="onboarding-actions" style={{ marginTop: 8 }}>
              <button type="button" className="button button-secondary" onClick={closeEditor} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? "Saving…" : editor.id ? "Save changes" : "Create budget"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <div className="month-summary-head">
          <h2>Overall budget</h2>
          {overall ? (
            <button className="button button-secondary button-sm" onClick={() => openOverallEditor(overall)}>
              Edit
            </button>
          ) : (
            <button className="button button-primary button-sm" onClick={() => openOverallEditor(null)}>
              + Set overall budget
            </button>
          )}
        </div>
        {rows === null && !listError && <div className="spinner" role="status" aria-label="Loading budgets" />}
        {listError && (
          <div className="alert alert-error" role="alert">
            {listError}
          </div>
        )}
        {rows !== null && !listError && !overall && (
          <div className="empty-state">
            <p>
              No overall budget for {monthLabel(selectedMonth, months)} yet. Set a monthly spending limit for all your
              expenses combined.
            </p>
          </div>
        )}
        {rows !== null && !listError && overall && renderProgress(overall)}
      </div>

      <div className="card">
        <div className="month-summary-head">
          <h2>Category budgets</h2>
          <button
            className="button button-primary button-sm"
            onClick={() => openCategoryEditor(null)}
            disabled={availableCategories.length === 0 && rows !== null}
          >
            + Add category budget
          </button>
        </div>
        {rows === null && !listError && <div className="spinner" role="status" aria-label="Loading category budgets" />}
        {rows !== null && !listError && categoryBudgets.length === 0 && (
          <div className="empty-state">
            <p>
              {expenseCategories.length === 0
                ? "You have no expense categories yet — add some in Settings first."
                : `No category budgets for ${monthLabel(selectedMonth, months)} yet. Add limits for categories like Food or Transportation.`}
            </p>
          </div>
        )}
        {rows !== null && !listError && categoryBudgets.length > 0 && (
          <div className="budget-category-list">
            {categoryBudgets.map((b) => (
              <div key={b.id} className="budget-category-row">
                <div className="budget-category-head">
                  <span className="category-name">{b.category_name}</span>
                  <div className="tx-item-actions">
                    <button className="button button-secondary button-sm" onClick={() => openCategoryEditor(b)}>
                      Edit
                    </button>
                    <button className="button button-danger button-sm" onClick={() => setConfirmDelete(b)}>
                      Delete
                    </button>
                  </div>
                </div>
                {renderProgress(b)}
              </div>
            ))}
          </div>
        )}
        {rows !== null && !listError && categoryBudgets.length > 0 && availableCategories.length > 0 && (
          <p className="section-note" style={{ marginTop: 12 }}>
            Categories without a budget: {availableCategories.map((c) => c.name).join(", ")}.
          </p>
        )}
        {rows !== null && !listError && categoryBudgets.length > 0 && availableCategories.length === 0 && (
          <p className="section-note" style={{ marginTop: 12 }}>
            Every expense category has a budget for this month.
          </p>
        )}
      </div>

      <div className="card">
        <h2>How spending is measured</h2>
        <p className="section-note" style={{ marginBottom: 0 }}>
          Budget progress uses your actual expense transactions for the selected month — never estimates. The overall
          budget counts every expense; a category budget counts only that category's expenses.
        </p>
      </div>

      {confirmDelete && (
        <div className="modal-overlay" role="presentation">
          <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="budget-delete-title">
            <h2 id="budget-delete-title">Delete this budget?</h2>
            <p className="center-note" style={{ textAlign: "left", padding: "4px 0 16px" }}>
              {confirmDelete.category_name
                ? `The ${confirmDelete.category_name} budget for ${monthLabel(confirmDelete.month.slice(0, 7), months)} will be removed. Your transactions are not affected.`
                : `The overall budget for ${monthLabel(confirmDelete.month.slice(0, 7), months)} will be removed. Your transactions are not affected.`}
            </p>
            <div className="onboarding-actions" style={{ marginTop: 0 }}>
              <button className="button button-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>
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

function monthLabel(ym: string, months: MonthOption[]): string {
  const found = months.find((m) => m.ym === ym);
  if (found) {
    return found.label;
  }
  const [y, m] = ym.split("-");
  const date = new Date(Number(y ?? "2026"), Number(m ?? "1") - 1, 1);
  return date.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
}
