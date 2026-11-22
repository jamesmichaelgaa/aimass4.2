import { useAuth } from "../lib/auth";
import { isValidCurrency } from "../lib/types";
import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export default function Settings() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [timezone, setTimezone] = useState(profile?.timezone ?? "Asia/Manila");
  const [currency, setCurrency] = useState(profile?.preferred_currency ?? "PHP");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const upper = currency.trim().toUpperCase();
    if (!isValidCurrency(upper)) {
      setMessage({ kind: "error", text: "Currency must be a 3-letter code such as PHP." });
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim() === "" ? null : displayName.trim(),
          timezone: timezone.trim() === "" ? "Asia/Manila" : timezone.trim(),
          preferred_currency: upper,
        })
        .eq("id", profile?.id ?? "");
      if (updateError) {
        setMessage(
          updateError.message.includes("financial records")
            ? { kind: "error", text: "You already have financial records, so the currency can no longer be changed." }
            : { kind: "error", text: "Could not save your settings. Please try again." }
        );
        return;
      }
      await refreshProfile();
      setMessage({ kind: "success", text: "Settings saved." });
    } catch {
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="dashboard-grid">
      <h1>Settings</h1>
      <div className="card">
        <form className="form-grid" onSubmit={handleSave} noValidate>
          {message && (
            <div className={`alert alert-${message.kind === "success" ? "success" : "error"}`} role="status">
              {message.text}
            </div>
          )}
          <div className="field">
            <label htmlFor="set-display-name">Display name</label>
            <input
              id="set-display-name"
              className="input"
              type="text"
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="set-timezone">Timezone</label>
            <input
              id="set-timezone"
              className="input"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="set-currency">
              Preferred currency{" "}
              <span className="hint">(locked once financial records exist)</span>
            </label>
            <input
              id="set-currency"
              className="input"
              type="text"
              maxLength={3}
              autoCapitalize="characters"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </form>
      </div>
      <div className="card">
        <h2>Account</h2>
        <p className="center-note" style={{ textAlign: "left", padding: "4px 0 12px" }}>
          Signed in as {profile?.id ? "your account" : "…"}. Signing out clears this device's session.
        </p>
        <button className="button button-secondary" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
