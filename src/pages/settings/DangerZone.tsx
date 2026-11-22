import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { supabase, supabaseUrl } from "../../lib/supabase";

type Step = "idle" | "confirming" | "deleting";

const GENERIC_ERROR = "Could not delete your account. Nothing was deleted — please try again.";

export default function DangerZone() {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();

  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    setPasswordError(null);
    setPassword("");
    setStep("confirming");
  }

  function closeDialog() {
    if (step === "deleting") {
      return;
    }
    setStep("idle");
    setPassword("");
    setError(null);
    setPasswordError(null);
  }

  async function handleDelete(event: FormEvent) {
    event.preventDefault();
    if (step === "deleting") {
      return;
    }
    setError(null);
    if (password.length === 0) {
      setPasswordError("Enter your password to confirm.");
      return;
    }
    setStep("deleting");
    setPasswordError(null);
    try {
      // Re-authentication: the fresh sign-in proves the person holding this
      // session knows the password. Its token is what authorizes deletion.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email ?? "",
        password,
      });
      if (signInError) {
        setStep("confirming");
        setPassword("");
        setPasswordError("Password is incorrect. Nothing was deleted.");
        return;
      }
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        setStep("confirming");
        setError(GENERIC_ERROR);
        return;
      }
      const response = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      let body: { deleted?: unknown; error?: unknown } = {};
      try {
        body = await response.json();
      } catch {
        // fall through to the status check
      }
      if (response.ok && body.deleted === true) {
        // The account no longer exists; clear the local session and return
        // to sign-in. Success is shown by being signed out at the login page.
        await signOut();
        navigate("/login", { replace: true });
        return;
      }
      if (response.status === 401) {
        setStep("confirming");
        setError("Your session expired. Nothing was deleted — please try again.");
        return;
      }
      setStep("confirming");
      setError(typeof body.error === "string" ? body.error : GENERIC_ERROR);
    } catch {
      setStep("confirming");
      setError(GENERIC_ERROR);
    }
  }

  return (
    <div className="card">
      <h2>Danger zone</h2>
      <p className="center-note" style={{ textAlign: "left", padding: "4px 0 12px" }}>
        Deleting your account permanently removes your profile, transactions, budgets, categories, recurring bills,
        bill-payment history, cash position, and salary schedule. <strong>This cannot be undone</strong> — there is no
        recovery afterward.
      </p>
      <button className="button button-danger" onClick={openDialog} disabled={step === "deleting"}>
        {step === "deleting" ? "Deleting…" : "Delete account…"}
      </button>

      {step !== "idle" && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="danger-zone-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeDialog();
            }
          }}
        >
          <div className="modal">
            <h3 id="danger-zone-title">Delete your account permanently?</h3>
            <p>
              Everything you entered — every transaction, budget, bill, and setting — will be erased for good. This
              action is permanent and cannot be undone.
            </p>
            <form className="form-grid" onSubmit={handleDelete} noValidate>
              {error && (
                <div className="alert alert-error" role="alert">
                  {error}
                </div>
              )}
              <div className="field">
                <label htmlFor="danger-password">Confirm your password to continue</label>
                <input
                  id="danger-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={passwordError ? "danger-password-error" : undefined}
                  disabled={step === "deleting"}
                />
                {passwordError && (
                  <div id="danger-password-error" className="field-error">{passwordError}</div>
                )}
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={closeDialog}
                  disabled={step === "deleting"}
                >
                  Cancel
                </button>
                <button type="submit" className="button button-danger" disabled={step === "deleting"}>
                  {step === "deleting" ? "Deleting permanently…" : "Delete everything"}
                </button>
              </div>
              <p className="center-note" style={{ margin: 0, textAlign: "left" }}>
                {step === "deleting"
                  ? "Deleting your account and all of its data — this usually takes a few seconds."
                  : "You will be signed out immediately after deletion."}
              </p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
