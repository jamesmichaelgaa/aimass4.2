import { useEffect, useState, type FormEvent } from "react";
import { fetchCashPosition, saveCashPosition, validateCashInput } from "../../lib/cash";
import { formatCurrency, type CashPosition } from "../../lib/types";
import { useAuth } from "../../lib/auth";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function CashEditor() {
  const { profile } = useAuth();
  const currency = profile?.preferred_currency ?? "PHP";

  const [cash, setCash] = useState<CashPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [amount, setAmount] = useState("");
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; date?: string }>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchCashPosition();
        if (cancelled) {
          return;
        }
        setCash(loaded);
        if (loaded) {
          setAmount(loaded.amount);
          setAsOfDate(loaded.as_of_date);
        }
        setLoading(false);
      } catch {
        if (!cancelled) {
          setLoadError(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const validated = validateCashInput(amount, asOfDate);
    if (!validated.ok) {
      setFieldErrors(validated.errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    const error = await saveCashPosition(validated.amount, validated.asOfDate);
    setSaving(false);
    if (error) {
      setMessage({ kind: "error", text: error });
      return;
    }
    const fresh = await fetchCashPosition();
    if (fresh) {
      setCash(fresh);
      setAmount(fresh.amount);
      setAsOfDate(fresh.as_of_date);
    }
    setMessage({ kind: "success", text: "Cash position saved — the dashboard and forecast will use it right away." });
  }

  if (loading) {
    return (
      <div className="card">
        <h2>Cash position</h2>
        <div className="spinner" role="status" aria-label="Loading your cash position" style={{ margin: "24px auto" }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card">
        <h2>Cash position</h2>
        <div className="alert alert-error" role="alert">
          Could not load your cash position. Please refresh the page to try again.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Cash position</h2>
      <p className="center-note" style={{ textAlign: "left", padding: "4px 0 12px" }}>
        {cash
          ? `Current: ${formatCurrency(cash.amount, currency)}, accurate as of ${cash.as_of_date}.`
          : "No cash position yet — enter one below to power your dashboard and payday forecast."}{" "}
        This is a number you enter yourself; the app never connects to a bank or e-wallet.
      </p>
      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        {message && (
          <div className={`alert alert-${message.kind === "success" ? "success" : "error"}`} role="status">
            {message.text}
          </div>
        )}
        <div className="field">
          <label htmlFor="set-cash-amount">Available cash ({currency})</label>
          <input
            id="set-cash-amount"
            className="input"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 8500.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(fieldErrors.amount)}
            aria-describedby={fieldErrors.amount ? "set-cash-amount-error" : undefined}
          />
          {fieldErrors.amount && (
            <div id="set-cash-amount-error" className="field-error">{fieldErrors.amount}</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="set-cash-date">Accurate as of</label>
          <input
            id="set-cash-date"
            className="input"
            type="date"
            max={todayIso()}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            aria-invalid={Boolean(fieldErrors.date)}
            aria-describedby={fieldErrors.date ? "set-cash-date-error" : undefined}
          />
          {fieldErrors.date && (
            <div id="set-cash-date-error" className="field-error">{fieldErrors.date}</div>
          )}
          <div className="hint" style={{ marginTop: 4 }}>
            The app treats this as your closing balance on this date and counts only later activity in your payday
            forecast.
          </div>
        </div>
        <div>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save cash position"}
          </button>
        </div>
      </form>
    </div>
  );
}
