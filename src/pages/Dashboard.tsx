import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { fetchMonthSummary, fetchTransactions } from "../lib/transactions";
import {
  budgetStatus,
  computeProgress,
  fetchBudgets,
  fetchExpenseTotals,
  monthBounds,
  type BudgetWithProgress,
} from "../lib/budgets";
import {
  formatCurrency,
  getMonthMeta,
  monthRange,
  type CashPosition,
  type IncomeSchedule,
  type Summary,
  type TransactionRow,
} from "../lib/types";

interface DashboardData {
  schedule: IncomeSchedule | null;
  cash: CashPosition | null;
}

export default function Dashboard() {
  const { profile, user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const meta = getMonthMeta();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [recent, setRecent] = useState<TransactionRow[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(true);
  const [txError, setTxError] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BudgetWithProgress[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [scheduleResult, cashResult] = await Promise.all([
          supabase
            .from("income_schedules")
            .select("*")
            .eq("is_active", true)
            .maybeSingle(),
          supabase
            .from("cash_positions")
            .select("*")
            .maybeSingle(),
        ]);
        if (cancelled) {
          return;
        }
        if (scheduleResult.error || cashResult.error) {
          setError("Could not load your dashboard. Please refresh to try again.");
          setLoading(false);
          return;
        }
        setData({
          schedule: (scheduleResult.data as IncomeSchedule | null) ?? null,
          cash: (cashResult.data as CashPosition | null) ?? null,
        });
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Could not load your dashboard. Please refresh to try again.");
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const range = monthRange(meta.ym);
    const budgetRange = monthBounds(meta.ym);
    Promise.all([
      fetchMonthSummary(range.start, range.end),
      fetchTransactions({ from: range.start, to: range.end, kind: null, categoryId: null }),
      fetchBudgets(meta.ym).then(async (budgetResult) => {
        if (budgetResult.error || budgetResult.budgets.length === 0) {
          return { error: budgetResult.error, budgets: [] as BudgetWithProgress[] };
        }
        const expenses = await fetchExpenseTotals(budgetRange.start, budgetRange.end);
        if (expenses.error) {
          return { error: expenses.error, budgets: [] as BudgetWithProgress[] };
        }
        return { error: null, budgets: computeProgress(budgetResult.budgets, expenses) };
      }),
    ]).then(([summaryResult, txResult, budgetResult]) => {
        if (cancelled) {
          return;
        }
        if ("error" in summaryResult) {
          setTxError(summaryResult.error);
        } else {
          setSummary(summaryResult);
        }
        if (txResult.error) {
          setTxError(txResult.error);
        } else {
          setRecent(txResult.rows.slice(0, 5));
        }
        setBudgets(budgetResult.error ? null : budgetResult.budgets);
        setSummaryLoading(false);
        setRecentLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currency = profile?.preferred_currency ?? "PHP";
  const firstName = (profile?.display_name ?? "").split(" ")[0] || null;
  const recentError = recent === null && !recentLoading && !txError;

  return (
    <div className="dashboard-grid">
      <h1>{firstName ? `Hello, ${firstName}` : "Your dashboard"}</h1>
      {loading && <div className="spinner" role="status" aria-label="Loading your dashboard" />}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && data && (
        <>
          <div className="card">
            <div className="month-summary-head">
              <h2>{meta.label} so far</h2>
              <Link to="/transactions" className="button button-primary">
                + Add a transaction
              </Link>
            </div>
            {summaryLoading && <div className="spinner" role="status" aria-label="Loading this month's totals" />}
            {!summaryLoading && txError && (
              <div className="alert alert-error" role="alert">
                {txError}
              </div>
            )}
            {!summaryLoading && !txError && summary && (
              <div className="summary-row">
                <div className="stat-inline">
                  <span className="stat-label">Income</span>
                  <span className="stat-value income">{formatCurrency(summary.income, currency)}</span>
                </div>
                <div className="stat-inline">
                  <span className="stat-label">Expenses</span>
                  <span className="stat-value expense">{formatCurrency(summary.expense, currency)}</span>
                </div>
                <div className="stat-inline">
                  <span className="stat-label">Net cash flow</span>
                  <span className={`stat-value ${summary.net.startsWith("-") ? "expense" : "income"}`}>
                    {formatCurrency(summary.net, currency)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="summary-row">
            <div className="card stat-card">
              <h3>Cash position</h3>
              {data.cash ? (
                <>
                  <div className="value">{formatCurrency(data.cash.amount, currency)}</div>
                  <div className="sub">Manually entered — accurate as of {data.cash.as_of_date}. Not a bank balance.</div>
                </>
              ) : (
                <>
                  <div className="value">—</div>
                  <div className="sub">No cash position yet.</div>
                </>
              )}
            </div>
            <div className="card stat-card">
              <h3>Next expected payday</h3>
              {data.schedule ? (
                <>
                  <div className="value">{data.schedule.next_payday}</div>
                  <div className="sub">
                    {data.schedule.frequency === "monthly" ? "Monthly" : "Every 14 days"} ·{" "}
                    {formatCurrency(data.schedule.expected_amount, currency)} expected (not yet received)
                  </div>
                </>
              ) : (
                <>
                  <div className="value">—</div>
                  <div className="sub">No salary schedule set.</div>
                </>
              )}
            </div>
          </div>

          {budgets !== null && budgets.length > 0 && (
            <div className="card">
              <div className="month-summary-head">
                <h2>Budgets for {meta.label}</h2>
                <Link to="/budgets" className="button button-secondary">
                  Manage budgets
                </Link>
              </div>
              <div className="budget-category-list">
                {budgets.map((b) => {
                  const status = budgetStatus(b);
                  const pct = Math.min(999, Math.round(b.percentUsed * 10) / 10);
                  return (
                    <div key={b.id} className="budget-category-row">
                      <div className="budget-category-head">
                        <span className="category-name">{b.category_name ?? "Overall budget"}</span>
                        <span className={status === "over" ? "over-text" : status === "warning" ? "warn-text" : "ok-text"}>
                          {formatCurrency(b.spent, currency)} / {formatCurrency(b.limit_amount, currency)} · {pct}%
                        </span>
                      </div>
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
                      {status === "over" && (
                        <div className="alert alert-error budget-alert">
                          {b.category_name ? `${b.category_name} budget exceeded` : "Overall budget exceeded"} —{" "}
                          {formatCurrency(b.remaining.startsWith("-") ? b.remaining.slice(1) : "0", currency)} over.
                        </div>
                      )}
                      {status === "warning" && (
                        <div className="alert alert-info budget-alert">
                          {b.category_name ? `${b.category_name} budget` : "Overall budget"} approaching the limit (80%+ used).
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card">
            <div className="month-summary-head">
              <h2>Recent transactions</h2>
              <Link to="/transactions" className="button button-secondary">
                View all
              </Link>
            </div>
            {recentLoading && <div className="spinner" role="status" aria-label="Loading recent transactions" />}
            {!recentLoading && recent && recent.length === 0 && (
              <p className="center-note">
                No transactions recorded this month yet. Use “Add a transaction” above to record your first income or
                expense.
              </p>
            )}
            {!recentLoading && recent && recent.length > 0 && (
              <div className="tx-list">
                {recent.map((row) => (
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
                  </div>
                ))}
              </div>
            )}
            {recentError && txError === null && (
              <p className="center-note">Recent transactions could not be loaded. Please refresh.</p>
            )}
          </div>

          <div className="card">
            <h2>Coming next</h2>
            <p className="center-note" style={{ padding: "8px 0" }}>
              Budgets, recurring bills, your payday forecast, and the AI assistant arrive in the next updates. Your
              profile and salary schedule are saved.
            </p>
            <Link to="/settings" className="button button-secondary">
              Review your settings
            </Link>
          </div>
          {user && !profile?.display_name && (
            <div className="alert alert-info">
              Tip: add your display name in Settings so the dashboard feels personal.
            </div>
          )}
        </>
      )}
    </div>
  );
}
