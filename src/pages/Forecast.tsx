import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { computeForecast, type ForecastResult, type ForecastUnavailable } from "../lib/forecast";
import { addSignedAmounts } from "../lib/types";
import { formatCurrency, type CashPosition, type IncomeSchedule } from "../lib/types";
import { fetchActiveSchedule } from "../lib/schedule";
import { fetchCashPosition, saveCashPosition, validateCashInput } from "../lib/cash";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface LoadState {
  schedule: IncomeSchedule | null;
  cash: CashPosition | null;
  error: string | null;
}

export default function Forecast() {
  const { profile } = useAuth();
  const currency = profile?.preferred_currency ?? "PHP";

  const [load, setLoad] = useState<LoadState | null>(null);
  const [forecast, setForecast] = useState<ForecastResult | ForecastUnavailable | null>(null);
  const [computing, setComputing] = useState(false);
  const [asOf, setAsOf] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [schedule, cash] = await Promise.all([fetchActiveSchedule(), fetchCashPosition()]);
        if (cancelled) {
          return;
        }
        setLoad({ schedule, cash, error: null });
        if (cash) {
          setAsOf(cash.as_of_date);
          setAmount(cash.amount);
        }
      } catch {
        if (!cancelled) {
          setLoad({ schedule: null, cash: null, error: "Could not load your forecast inputs. Please check your connection." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!load || !load.schedule || !load.cash) {
      return;
    }
    let cancelled = false;
    setComputing(true);
    setForecast(null);
    computeForecast(load.schedule, load.cash.amount, load.cash.as_of_date)
      .then((result) => {
        if (!cancelled) {
          setForecast(result);
          setComputing(false);
        }
      })
      .catch((cause: unknown) => {
        console.error("forecast computation failed", cause);
        if (!cancelled) {
          setForecast({
            ok: false,
            reason: "bad-dates",
            message: "Could not compute the forecast. Please refresh and try again — the technical cause was printed to the browser console (F12).",
          });
          setComputing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function handleSaveCash(event: React.FormEvent) {
    event.preventDefault();
    if (saving) {
      return;
    }
    setSaveMessage(null);
    const validated = validateCashInput(amount, asOf);
    if (!validated.ok) {
      setSaveMessage({ kind: "error", text: validated.errors.amount ?? validated.errors.date ?? "Check the values and try again." });
      return;
    }
    setSaving(true);
    const saveError = await saveCashPosition(validated.amount, validated.asOfDate);
    setSaving(false);
    if (saveError) {
      setSaveMessage({ kind: "error", text: saveError });
      return;
    }
    setSaveMessage({ kind: "success", text: "Cash position saved — forecast recalculated." });
    try {
      const [schedule, cash] = await Promise.all([fetchActiveSchedule(), fetchCashPosition()]);
      setLoad({ schedule, cash, error: null });
    } catch {
      setSaveMessage({ kind: "error", text: "Saved, but the forecast could not be refreshed. Please reload the page." });
    }
  }

  if (load === null) {
    return (
      <div className="dashboard-grid">
        <h1>Forecast</h1>
        <div className="spinner" role="status" aria-label="Loading your forecast" />
      </div>
    );
  }

  if (load.error) {
    return (
      <div className="dashboard-grid">
        <h1>Forecast</h1>
        <div className="alert alert-error" role="alert">
          {load.error}
        </div>
      </div>
    );
  }

  if (!load.schedule) {
    return (
      <div className="dashboard-grid">
        <h1>Forecast</h1>
        <div className="card">
          <div className="empty-state">
            <p>No salary schedule found. A forecast needs your expected salary and next payday.</p>
            <Link to="/onboarding/salary" className="button button-primary">
              Set your salary schedule
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!load.cash) {
    return (
      <div className="dashboard-grid">
        <h1>Forecast</h1>
        <div className="card">
          <div className="empty-state">
            <p>No cash position yet. A forecast starts from the balance you have available today.</p>
            <Link to="/onboarding/cash" className="button button-primary">
              Enter your cash position
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-grid">
      <div className="tx-page-head">
        <h1>Forecast</h1>
        <span className="forecast-estimate-badge">Estimate — not a guaranteed balance</span>
      </div>

      <div className="card">
        <h2>Cash position</h2>
        <form className="forecast-cash-form" onSubmit={handleSaveCash}>
          <div className="field">
            <label htmlFor="fc-amount">Available cash ({currency})</label>
            <input
              id="fc-amount"
              className="input"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="fc-asof">Accurate as of</label>
            <input
              id="fc-asof"
              className="input"
              type="date"
              value={asOf}
              max={todayIso()}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </div>
          <div className="field">
            <button className="button button-secondary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Update and recalculate"}
            </button>
          </div>
        </form>
        {saveMessage && (
          <div className={`alert alert-${saveMessage.kind === "success" ? "success" : "error"}`} role="status">
            {saveMessage.text}
          </div>
        )}
      </div>

      {computing && <div className="spinner" role="status" aria-label="Calculating your forecast" />}

      {!computing && forecast && !forecast.ok && (
        <div className="alert alert-error" role="alert">
          {forecast.message}
        </div>
      )}

      {!computing && forecast && forecast.ok && (
        <>
          <div className="summary-row">
            <div className="card stat-card">
              <h3>Starting cash</h3>
              <div className="value">{formatCurrency(forecast.startingCash, currency)}</div>
              <div className="sub">Closing balance as of {forecast.asOfDate}</div>
            </div>
            <div className="card stat-card">
              <h3>Estimated cash on payday</h3>
              <div className={`value ${forecast.estimatedEndingCash.startsWith("-") ? "net-negative" : "net-positive"}`}>
                {formatCurrency(forecast.estimatedEndingCash, currency)}
              </div>
              <div className="sub">End of forecast period: {forecast.endDate}</div>
            </div>
            <div className="card stat-card">
              <h3>Forecast period</h3>
              <div className="value">{forecast.startDate}</div>
              <div className="sub">Through {forecast.endDate} (payday, inclusive)</div>
            </div>
          </div>

          <div className="card">
            <h2>How the estimate is built</h2>
            <div className="summary-row forecast-lines">
              <div className="stat-inline">
                <span className="stat-label">Recorded income after {forecast.asOfDate}</span>
                <span className="stat-value income">{formatCurrency(forecast.recordedIncome, currency)}</span>
              </div>
              <div className="stat-inline">
                <span className="stat-label">Recorded expenses after {forecast.asOfDate}</span>
                <span className="stat-value expense">{formatCurrency(forecast.recordedExpenses, currency)}</span>
              </div>
              <div className="stat-inline">
                <span className="stat-label">
                  Expected salary on {forecast.endDate}{" "}
                  {forecast.expectedSalaryReconciled ? "(already recorded — not counted twice)" : "(not yet received)"}
                </span>
                <span className="stat-value income">{formatCurrency(forecast.expectedSalary, currency)}</span>
              </div>
              <div className="stat-inline">
                <span className="stat-label">Unpaid bills due before payday</span>
                <span className="stat-value expense">
                  {formatCurrency(
                    forecast.unpaidBills.reduce((sum, b) => addSignedAmounts([sum, `-${b.amount}`]), "0.00"),
                    currency
                  )}
                </span>
              </div>
            </div>
            <p className="section-note">
              Starting cash + recorded income − recorded expenses + expected salary − unpaid bills = estimate. Monthly
              paydays use calendar months (clamped to a month's last day); biweekly paydays recur exactly every 14
              days. Only transactions dated after the cash-position date count — the starting balance already includes
              anything before it. Already-paid bill occurrences are represented by their recorded expense and are not
              subtracted twice.
            </p>
          </div>

          {forecast.warnings.length > 0 && (
            <div className="card">
              <h2>Warnings and assumptions</h2>
              {forecast.warnings.map((w, i) => (
                <div key={i} className={`alert ${w.startsWith("Projected cash goes negative") ? "alert-error" : "alert-info"}`}>
                  {w}
                </div>
              ))}
              <p className="section-note" style={{ marginBottom: 0 }}>
                Bill amounts assume each occurrence is paid at its scheduled amount. Salary reconciliation matches a
                recorded "Salary"-category income within 3 days before payday at the expected amount; other income is
                never mistaken for salary. If your salary changed, update it in Settings.
              </p>
            </div>
          )}

          <div className="card">
            <h2>Timeline</h2>
            <div className="forecast-timeline">
              {forecast.events.map((event, i) => (
                <div key={i} className={`forecast-event event-${event.kind}`}>
                  <span className="forecast-event-date">{event.date}</span>
                  <span className="forecast-event-label">{event.label}</span>
                  <span className={`forecast-event-amount ${event.amount.startsWith("-") ? "expense" : "income"}`}>
                    {event.kind === "start" ? "" : event.amount.startsWith("-") ? "−" : "+"}
                    {event.kind === "start" ? "" : formatCurrency(event.amount.replace(/^-/, ""), currency)}
                  </span>
                </div>
              ))}
              <div className="forecast-event event-end">
                <span className="forecast-event-date">{forecast.endDate}</span>
                <span className="forecast-event-label">Estimated cash</span>
                <span className={`forecast-event-amount ${forecast.estimatedEndingCash.startsWith("-") ? "expense" : "income"}`}>
                  {formatCurrency(forecast.estimatedEndingCash, currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Upcoming unpaid bills in this window</h2>
            {forecast.unpaidBills.length === 0 ? (
              <p className="center-note">No unpaid bill occurrences fall due before payday.</p>
            ) : (
              <div className="tx-list">
                {forecast.unpaidBills.map((b) => (
                  <div key={`${b.billId}:${b.dueDate}`} className="tx-item">
                    <div className="tx-item-main">
                      <span className="tx-amount expense">−{formatCurrency(b.amount, currency)}</span>
                      <span className="tx-desc">{b.billName}</span>
                      <span className="tx-meta">Due {b.dueDate}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link to="/bills" className="button button-secondary" style={{ marginTop: 12 }}>
              Review your bills
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
