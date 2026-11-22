import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createCategory, deleteCategory, fetchCategories } from "../lib/transactions";
import { type Category, type TransactionKind } from "../lib/types";

const MAX_NAME_LENGTH = 60;

function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export default function CategoryManager() {
  const [income, setIncome] = useState<Category[]>([]);
  const [expense, setExpense] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [newIncomeName, setNewIncomeName] = useState("");
  const [newExpenseName, setNewExpenseName] = useState("");
  const [addError, setAddError] = useState<{ income: string | null; expense: string | null }>({
    income: null,
    expense: null,
  });
  const [addingIncome, setAddingIncome] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await fetchCategories();
    setIncome(result.income);
    setExpense(result.expense);
    setListError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleAdd(kind: TransactionKind) {
    const raw = kind === "income" ? newIncomeName : newExpenseName;
    const name = normalizeName(raw);
    if (kind === "income") {
      setAddError((prev) => ({ ...prev, income: null }));
    } else {
      setAddError((prev) => ({ ...prev, expense: null }));
    }
    if (name === "") {
      setAddError((prev) => ({ ...prev, [kind]: "Enter a category name." }));
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      setAddError((prev) => ({ ...prev, [kind]: `Keep the name under ${MAX_NAME_LENGTH} characters.` }));
      return;
    }
    const existing = kind === "income" ? income : expense;
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setAddError((prev) => ({ ...prev, [kind]: "You already have a category with that name for this type." }));
      return;
    }
    if (kind === "income") {
      setAddingIncome(true);
    } else {
      setAddingExpense(true);
    }
    const result = await createCategory(name, kind);
    if (kind === "income") {
      setAddingIncome(false);
    } else {
      setAddingExpense(false);
    }
    if (result.error) {
      setAddError((prev) => ({ ...prev, [kind]: result.error }));
      return;
    }
    if (kind === "income") {
      setNewIncomeName("");
    } else {
      setNewExpenseName("");
    }
    void reload();
  }

  async function handleDelete() {
    if (!confirmDeleteId || deleting) {
      return;
    }
    setDeleting(true);
    const result = await deleteCategory(confirmDeleteId);
    setDeleting(false);
    setConfirmDeleteId(null);
    if (result.error) {
      setListError(result.error);
      return;
    }
    void reload();
  }

  function renderList(cats: Category[]) {
    return cats.map((c) => (
      <div key={c.id} className="category-row">
        <span className="category-name">{c.name}</span>
        {c.is_system ? (
          <span className="badge">Default</span>
        ) : (
          <button className="button button-danger button-sm" onClick={() => setConfirmDeleteId(c.id)}>
            Delete
          </button>
        )}
      </div>
    ));
  }

  return (
    <div className="card">
      <h2>Categories</h2>
      <p className="section-note">Group your income and expenses. Default categories cannot be renamed or deleted.</p>
      {loading && <div className="spinner" role="status" aria-label="Loading categories" />}
      {listError && (
        <div className="alert alert-error" role="alert">
          {listError}
        </div>
      )}
      {!loading && (
        <div className="category-columns">
          <section aria-labelledby="cat-income-h">
            <h3 id="cat-income-h">Income categories</h3>
            <div className="category-list">{renderList(income)}</div>
            <form
              className="category-add"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void handleAdd("income");
              }}
            >
              <label className="visually-hidden" htmlFor="new-income-category">
                New income category name
              </label>
              <input
                id="new-income-category"
                className="input"
                type="text"
                maxLength={MAX_NAME_LENGTH}
                placeholder="Add income category"
                value={newIncomeName}
                onChange={(e) => setNewIncomeName(e.target.value)}
              />
              <button className="button button-secondary" type="submit" disabled={addingIncome}>
                {addingIncome ? "Adding…" : "Add"}
              </button>
            </form>
            {addError.income && (
              <div className="alert alert-error" role="alert">
                {addError.income}
              </div>
            )}
          </section>
          <section aria-labelledby="cat-expense-h">
            <h3 id="cat-expense-h">Expense categories</h3>
            <div className="category-list">{renderList(expense)}</div>
            <form
              className="category-add"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void handleAdd("expense");
              }}
            >
              <label className="visually-hidden" htmlFor="new-expense-category">
                New expense category name
              </label>
              <input
                id="new-expense-category"
                className="input"
                type="text"
                maxLength={MAX_NAME_LENGTH}
                placeholder="Add expense category"
                value={newExpenseName}
                onChange={(e) => setNewExpenseName(e.target.value)}
              />
              <button className="button button-secondary" type="submit" disabled={addingExpense}>
                {addingExpense ? "Adding…" : "Add"}
              </button>
            </form>
            {addError.expense && (
              <div className="alert alert-error" role="alert">
                {addError.expense}
              </div>
            )}
          </section>
        </div>
      )}

      {confirmDeleteId && (
        <div className="modal-overlay" role="presentation">
          <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="cat-delete-title">
            <h2 id="cat-delete-title">Delete this category?</h2>
            <p className="center-note" style={{ textAlign: "left", padding: "4px 0 16px" }}>
              Only categories with no transactions can be deleted.
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
