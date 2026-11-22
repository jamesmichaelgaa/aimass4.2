import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { isValidDate, parsePositiveAmount, type SalaryFrequency } from "../../lib/types";

function suggestNextPayday(frequency: SalaryFrequency): string {
  const now = new Date();
  if (frequency === "monthly") {
    const day = Math.min(now.getDate(), 15);
    const candidate = new Date(now.getFullYear(), now.getMonth(), day);
    if (candidate.getTime() <= now.getTime()) {
      return new Date(now.getFullYear(), now.getMonth() + 1, day).toISOString().slice(0, 10);
    }
    return candidate.toISOString().slice(0, 10);
  }
  return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function SalaryStep() {
  const navigate = useNavigate();
  const [frequency, setFrequency] = useState<SalaryFrequency>("monthly");
  const [amount, setAmount] = useState("");
  const [nextPayday, setNextPayday] = useState(() => suggestNextPayday("monthly"));
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; payday?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFrequencyChange(next: SalaryFrequency) {
    setFrequency(next);
    setNextPayday((current) => (current === suggestNextPayday("monthly") || current === suggestNextPayday("biweekly")
      ? suggestNextPayday(next)
      : current));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const errors: { amount?: string; payday?: string } = {};
    const parsedAmount = parsePositiveAmount(amount);
    if (parsedAmount === null) {
      errors.amount = "Enter your expected salary as a positive amount, e.g. 25000.00.";
    }
    if (!isValidDate(nextPayday)) {
      errors.payday = "Enter a valid date (YYYY-MM-DD).";
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
      const { error: scheduleError } = await supabase.from("income_schedules").insert({
        label: "Salary",
        expected_amount: parsedAmount!.toFixed(2),
        frequency,
        next_payday: nextPayday,
        is_active: true,
      });
      if (scheduleError) {
        setError("Could not save your salary schedule. Please try again.");
        return;
      }
      navigate("/onboarding/cash");
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
        <span className="step current" />
        <span className="step" />
      </div>
      <h1>Your salary schedule</h1>
      <p className="tagline" style={{ textAlign: "left", marginBottom: 20 }}>
        How often are you paid, roughly how much, and when is your next payday? You can change
        these any time in Settings.
      </p>
      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="field" role="radiogroup" aria-label="Salary frequency">
          <label>How often are you paid?</label>
          <div className="radio-cards">
            <label className={`radio-card ${frequency === "monthly" ? "selected" : ""}`}>
              <span className="title">
                <input
                  type="radio"
                  name="frequency"
                  value="monthly"
                  checked={frequency === "monthly"}
                  onChange={() => handleFrequencyChange("monthly")}
                />
                Monthly
              </span>
              <span className="desc">Once a month, e.g. every 15th.</span>
            </label>
            <label className={`radio-card ${frequency === "biweekly" ? "selected" : ""}`}>
              <span className="title">
                <input
                  type="radio"
                  name="frequency"
                  value="biweekly"
                  checked={frequency === "biweekly"}
                  onChange={() => handleFrequencyChange("biweekly")}
                />
                Biweekly
              </span>
              <span className="desc">Every 14 days.</span>
            </label>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ob-amount">Expected salary per payday</label>
          <input
            id="ob-amount"
            className="input"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 25000.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(fieldErrors.amount)}
            aria-describedby={fieldErrors.amount ? "ob-amount-error" : undefined}
          />
          {fieldErrors.amount && (
            <div id="ob-amount-error" className="field-error">{fieldErrors.amount}</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="ob-payday">Next expected payday</label>
          <input
            id="ob-payday"
            className="input"
            type="date"
            value={nextPayday}
            onChange={(e) => setNextPayday(e.target.value)}
            aria-invalid={Boolean(fieldErrors.payday)}
            aria-describedby={fieldErrors.payday ? "ob-payday-error" : undefined}
          />
          {fieldErrors.payday && (
            <div id="ob-payday-error" className="field-error">{fieldErrors.payday}</div>
          )}
        </div>
        <div className="onboarding-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate("/onboarding/profile")}
            disabled={submitting}
          >
            Back
          </button>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
