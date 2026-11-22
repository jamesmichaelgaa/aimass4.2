import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { isValidDate, parseNonNegativeAmount } from "../../lib/types";

export default function CashStep() {
  const navigate = useNavigate();
  const { markOnboarded } = useAuth();
  const [amount, setAmount] = useState("");
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; date?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const errors: { amount?: string; date?: string } = {};
    const parsedAmount = parseNonNegativeAmount(amount);
    if (parsedAmount === null) {
      errors.amount = "Enter your current cash as an amount of 0 or more, e.g. 8500.00.";
    }
    if (!isValidDate(asOfDate)) {
      errors.date = "Enter a valid date (YYYY-MM-DD).";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        setError("Your session expired. Please sign in again.");
        return;
      }
      const { error: upsertError } = await supabase.from("cash_positions").upsert({
        amount: parsedAmount!.toFixed(2),
        as_of_date: asOfDate,
      });
      if (upsertError) {
        setError("Could not save your cash position. Please try again.");
        return;
      }
      markOnboarded();
      navigate("/", { replace: true });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="onboarding-steps" aria-hidden="true">
        <span className="step done" />
        <span className="step done" />
        <span className="step current" />
      </div>
      <h1>Your current cash</h1>
      <p className="tagline" style={{ textAlign: "left", marginBottom: 12 }}>
        How much spendable cash do you have right now? This is a number you enter yourself —
        the app never connects to a bank or e-wallet.
      </p>
      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="ob-cash-amount">Available cash</label>
          <input
            id="ob-cash-amount"
            className="input"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 8500.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(fieldErrors.amount)}
            aria-describedby={fieldErrors.amount ? "ob-cash-amount-error" : undefined}
          />
          {fieldErrors.amount && (
            <div id="ob-cash-amount-error" className="field-error">{fieldErrors.amount}</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="ob-cash-date">Accurate as of</label>
          <input
            id="ob-cash-date"
            className="input"
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            aria-invalid={Boolean(fieldErrors.date)}
            aria-describedby={fieldErrors.date ? "ob-cash-date-error" : undefined}
          />
          {fieldErrors.date && (
            <div id="ob-cash-date-error" className="field-error">{fieldErrors.date}</div>
          )}
          <div className="hint" style={{ marginTop: 4 }}>
            The app treats this as your closing balance on this date and counts only later
            activity in your payday forecast.
          </div>
        </div>
        <div className="onboarding-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate("/onboarding/salary")}
            disabled={submitting}
          >
            Back
          </button>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Finish setup"}
          </button>
        </div>
      </form>
    </div>
  );
}
