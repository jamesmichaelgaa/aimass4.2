import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { isValidCurrency } from "../../lib/types";

export default function OnboardingProfile() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [currency, setCurrency] = useState(profile?.preferred_currency ?? "PHP");
  const [timezone, setTimezone] = useState(profile?.timezone ?? "Asia/Manila");
  const [fieldErrors, setFieldErrors] = useState<{ currency?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const upper = currency.trim().toUpperCase();
    if (!isValidCurrency(upper)) {
      setFieldErrors({ currency: "Use a 3-letter currency code such as PHP." });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim() === "" ? null : displayName.trim(),
          preferred_currency: upper,
          timezone: timezone.trim() === "" ? "Asia/Manila" : timezone.trim(),
        })
        .eq("id", profile?.id ?? "");
      if (updateError) {
        setError(
          updateError.message.includes("financial records")
            ? "You already have financial records, so the currency can no longer be changed."
            : "Could not save your profile. Please try again."
        );
        return;
      }
      await refreshProfile();
      navigate("/onboarding/salary");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="onboarding-steps" aria-hidden="true">
        <span className="step current" />
        <span className="step" />
        <span className="step" />
      </div>
      <h1>Welcome — let's set things up</h1>
      <p className="tagline" style={{ textAlign: "left", marginBottom: 20 }}>
        First, your profile. This is how the app formats amounts and dates for you.
      </p>
      <form className="form-grid" onSubmit={handleSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="ob-display-name">
            Display name <span className="hint">(optional)</span>
          </label>
          <input
            id="ob-display-name"
            className="input"
            type="text"
            maxLength={60}
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ob-currency">
            Preferred currency <span className="hint">(PHP is the default; amounts use this label)</span>
          </label>
          <input
            id="ob-currency"
            className="input"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            aria-invalid={Boolean(fieldErrors.currency)}
            aria-describedby={fieldErrors.currency ? "ob-currency-error" : undefined}
          />
          {fieldErrors.currency && (
            <div id="ob-currency-error" className="field-error">{fieldErrors.currency}</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="ob-timezone">Timezone</label>
          <input
            id="ob-timezone"
            className="input"
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-describedby="ob-timezone-hint"
          />
          <div id="ob-timezone-hint" className="hint" style={{ marginTop: 4 }}>
            Dates and reminders use this timezone. The default is Asia/Manila.
          </div>
        </div>
        <div className="onboarding-actions">
          <span />
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
