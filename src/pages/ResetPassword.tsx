import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Stage = "checking" | "form" | "invalid" | "success";

type FieldErrors = { password?: string; confirm?: string };

const DEFAULT_INVALID =
  "This password reset link is invalid or has expired. Request a new reset email and try again.";

function linkErrorParams(): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of new URLSearchParams(window.location.hash.replace(/^#/, ""))) {
    if (!params.has(key)) {
      params.set(key, value);
    }
  }
  return params;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("checking");
  const [invalidReason, setInvalidReason] = useState<string>(DEFAULT_INVALID);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // supabase-js exchanges the recovery-link token for a session during
      // initialization; getSession waits for that exchange to finish.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const { data } = await supabase.auth.getSession();
          if (cancelled) {
            return;
          }
          if (data.session) {
            setStage("form");
            return;
          }
        } catch {
          if (!cancelled) {
            setStage("invalid");
            return;
          }
        }
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      }
      if (cancelled) {
        return;
      }
      const params = linkErrorParams();
      if (params.get("error") || params.get("error_description")) {
        setInvalidReason(
          "This password reset link has expired or was already used. Request a new reset email and try again."
        );
      }
      setStage("invalid");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (password.length < 8) {
      errors.password = "Use at least 8 characters.";
    }
    if (confirm !== password) {
      errors.confirm = "Passwords do not match.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validate()) {
      return;
    }
    setSubmitting(true);
    try {
      // updateUser requires a valid session; without one the server rejects
      // the change, so an unauthenticated visitor can never set a password.
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        const message = updateError.message.toLowerCase();
        if (message.includes("session") || message.includes("sign in")) {
          setStage("invalid");
          return;
        }
        if (message.includes("password") && message.includes("least")) {
          setError("Use at least 8 characters for your new password.");
          return;
        }
        setError("Could not update your password. Please try again.");
        return;
      }
      setPassword("");
      setConfirm("");
      setStage("success");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoSignIn() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  if (stage === "checking") {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="brand">Budget Buddy</div>
          <div className="spinner" role="status" aria-label="Checking your reset link" />
        </div>
      </div>
    );
  }

  if (stage === "invalid") {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="brand">Budget Buddy</div>
          <h2>Reset link not usable</h2>
          <div className="alert alert-error" role="alert">
            {invalidReason}
          </div>
          <div className="form-grid">
            <Link to="/login" className="button button-primary button-block" style={{ textDecoration: "none" }}>
              Back to sign in
            </Link>
          </div>
          <p className="center-note" style={{ marginTop: 12 }}>
            From the sign-in page, enter your email and tap "Forgot password?" to get a fresh link.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "success") {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="brand">Budget Buddy</div>
          <h2>Password updated</h2>
          <div className="alert alert-success" role="status">
            Your password has been changed. Use it the next time you sign in.
          </div>
          <div className="form-grid">
            <button className="button button-primary button-block" onClick={() => void handleGoSignIn()}>
              Sign in with your new password
            </button>
            <Link to="/login" className="button button-secondary button-block" style={{ textDecoration: "none" }}>
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="brand">Budget Buddy</div>
        <p className="tagline">Choose a new password for your account.</p>
        <form className="form-grid" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "reset-password-error" : undefined}
            />
            {fieldErrors.password && (
              <div id="reset-password-error" className="field-error">{fieldErrors.password}</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="reset-confirm">Confirm new password</label>
            <input
              id="reset-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={Boolean(fieldErrors.confirm)}
              aria-describedby={fieldErrors.confirm ? "reset-confirm-error" : undefined}
            />
            {fieldErrors.confirm && (
              <div id="reset-confirm-error" className="field-error">{fieldErrors.confirm}</div>
            )}
          </div>
          <button className="button button-primary button-block" type="submit" disabled={submitting}>
            {submitting ? "Updating…" : "Update password"}
          </button>
          <p className="center-note" style={{ margin: 0 }}>
            <Link to="/login">Back to sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
