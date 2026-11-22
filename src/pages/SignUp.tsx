import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

type FieldErrors = { email?: string; password?: string; confirm?: string };

export default function SignUp() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
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
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) {
        if (signUpError.message.toLowerCase().includes("already registered")) {
          setError("That email already has an account. Try signing in instead.");
        } else {
          setError("Could not create your account. Please try again.");
        }
        return;
      }
      setCheckEmail(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkEmail) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="brand">aimass</div>
          <h2>Check your email</h2>
          <p className="tagline">
            We sent a confirmation link to {email.trim()}. Open it to finish creating
            your account, then sign in.
          </p>
          <div className="form-grid">
            <button className="button button-primary button-block" onClick={() => navigate("/login")}>
              Go to sign in
            </button>
            <Link to="/signup" className="button button-secondary button-block" style={{ textDecoration: "none" }}>
              Use a different email
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
        <p className="tagline">Know where your salary goes — and make it last until payday.</p>
        <form className="form-grid" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
            />
            {fieldErrors.email && (
              <div id="signup-email-error" className="field-error">{fieldErrors.email}</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
            />
            {fieldErrors.password && (
              <div id="signup-password-error" className="field-error">{fieldErrors.password}</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="signup-confirm">Confirm password</label>
            <input
              id="signup-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={Boolean(fieldErrors.confirm)}
              aria-describedby={fieldErrors.confirm ? "signup-confirm-error" : undefined}
            />
            {fieldErrors.confirm && (
              <div id="signup-confirm-error" className="field-error">{fieldErrors.confirm}</div>
            )}
          </div>
          <button className="button button-primary button-block" type="submit" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
          <p className="center-note" style={{ margin: 0 }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
