import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../lib/auth";
import { fetchActiveSchedule, saveSchedule, validateScheduleInput } from "../../lib/schedule";
import { formatCurrency, type IncomeSchedule, type SalaryFrequency } from "../../lib/types";

const FREQUENCY_LABELS: Record<SalaryFrequency, string> = {
  monthly: "Monthly",
  biweekly: "Every 14 days (biweekly)",
};

export default function ScheduleEditor() {
  const { profile } = useAuth();
  const currency = profile?.preferred_currency ?? "PHP";

  const [schedule, setSchedule] = useState<IncomeSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<SalaryFrequency>("monthly");
  const [nextPayday, setNextPayday] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; payday?: string }>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchActiveSchedule();
        if (cancelled) {
          return;
        }
        setSchedule(loaded);
        if (loaded) {
          setAmount(loaded.expected_amount);
          setFrequency(loaded.frequency);
          setNextPayday(loaded.next_payday);
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
    const validated = validateScheduleInput({ amountRaw: amount, frequency, nextPayday });
    if (!validated.ok) {
      setFieldErrors(validated.errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    const error = await saveSchedule(
      { amount: validated.amount, frequency: validated.frequency, nextPayday: validated.nextPayday },
      schedule
    );
    setSaving(false);
    if (error) {
      setMessage({ kind: "error", text: error });
      return;
    }
    const fresh = await fetchActiveSchedule();
    if (fresh) {
      setSchedule(fresh);
      setAmount(fresh.expected_amount);
      setFrequency(fresh.frequency);
      setNextPayday(fresh.next_payday);
    }
    setMessage({
      kind: "success",
      text: "Salary schedule saved — the dashboard and forecast will use it right away.",
    });
  }

  if (loading) {
    return (
      <div className="card">
        <h2>Salary schedule</h2>
        <div className="spinner" role="status" aria-label="Loading your salary schedule" style={{ margin: "24px auto" }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card">
        <h2>Salary schedule</h2>
        <div className="alert alert-error" role="alert">
          Could not load your salary schedule. Please refresh the page to try again.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Salary schedule</h2>
      {schedule && (
        <p className="center-note" style={{ textAlign: "left", padding: "4px 0 12px" }}>
          Current: {formatCurrency(schedule.expected_amount, currency)} · {FREQUENCY_LABELS[schedule.frequency]} ·
          next payday {schedule.next_payday}
        </p>
      )}
      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        {message && (
          <div className={`alert alert-${message.kind === "success" ? "success" : "error"}`} role="status">
            {message.text}
          </div>
        )}
        <div className="field" role="radiogroup" aria-label="Pay frequency">
          <label>How often are you paid?</label>
          <div className="radio-cards">
            <label className={`radio-card ${frequency === "monthly" ? "selected" : ""}`}>
              <span className="title">
                <input
                  type="radio"
                  name="settings-frequency"
                  value="monthly"
                  checked={frequency === "monthly"}
                  onChange={() => setFrequency("monthly")}
                />
                Monthly
              </span>
              <span className="desc">Once a month, e.g. every 15th.</span>
            </label>
            <label className={`radio-card ${frequency === "biweekly" ? "selected" : ""}`}>
              <span className="title">
                <input
                  type="radio"
                  name="settings-frequency"
                  value="biweekly"
                  checked={frequency === "biweekly"}
                  onChange={() => setFrequency("biweekly")}
                />
                Biweekly
              </span>
              <span className="desc">Every 14 days.</span>
            </label>
          </div>
        </div>
        <div className="field">
          <label htmlFor="set-salary-amount">Expected salary per payday ({currency})</label>
          <input
            id="set-salary-amount"
            className="input"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 25000.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(fieldErrors.amount)}
            aria-describedby={fieldErrors.amount ? "set-salary-amount-error" : undefined}
          />
          {fieldErrors.amount && (
            <div id="set-salary-amount-error" className="field-error">{fieldErrors.amount}</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="set-salary-payday">Next expected payday</label>
          <input
            id="set-salary-payday"
            className="input"
            type="date"
            value={nextPayday}
            onChange={(e) => setNextPayday(e.target.value)}
            aria-invalid={Boolean(fieldErrors.payday)}
            aria-describedby={fieldErrors.payday ? "set-salary-payday-error" : undefined}
          />
          {fieldErrors.payday && (
            <div id="set-salary-payday-error" className="field-error">{fieldErrors.payday}</div>
          )}
          <div className="hint" style={{ marginTop: 4 }}>
            Monthly paydays use calendar months (a missing day clamps to the month's last day); biweekly paydays recur
            exactly every 14 days.
          </div>
        </div>
        <div>
          <button className="button button-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save salary schedule"}
          </button>
        </div>
      </form>
    </div>
  );
}
