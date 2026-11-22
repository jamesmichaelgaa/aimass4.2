import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { formatCurrency, type CashPosition, type IncomeSchedule } from "../lib/types";

interface DashboardData {
  schedule: IncomeSchedule | null;
  cash: CashPosition | null;
}

export default function Dashboard() {
  const { profile, user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [scheduleResult, cashResult] = await Promise.all([
          supabase
            .from("income_schedules")
            .select("*")
            .eq("is_active", true)
            .maybeSingle(),
          supabase
            .from("cash_positions")
            .select("*")
            .maybeSingle(),
        ]);
        if (cancelled) {
          return;
        }
        if (scheduleResult.error || cashResult.error) {
          setError("Could not load your dashboard. Please refresh to try again.");
          setLoading(false);
          return;
        }
        setData({
          schedule: (scheduleResult.data as IncomeSchedule | null) ?? null,
          cash: (cashResult.data as CashPosition | null) ?? null,
        });
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("Could not load your dashboard. Please refresh to try again.");
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const currency = profile?.preferred_currency ?? "PHP";
  const firstName = (profile?.display_name ?? "").split(" ")[0] || null;

  return (
    <div className="dashboard-grid">
      <h1>{firstName ? `Hello, ${firstName}` : "Your dashboard"}</h1>
      {loading && <div className="spinner" role="status" aria-label="Loading your dashboard" />}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {!loading && !error && data && (
        <>
          <div className="card stat-card">
            <h3>Cash position</h3>
            {data.cash ? (
              <>
                <div className="value">{formatCurrency(data.cash.amount, currency)}</div>
                <div className="sub">Manually entered — accurate as of {data.cash.as_of_date}. Not a bank balance.</div>
              </>
            ) : (
              <>
                <div className="value">—</div>
                <div className="sub">No cash position yet.</div>
              </>
            )}
          </div>
          <div className="card stat-card">
            <h3>Next expected payday</h3>
            {data.schedule ? (
              <>
                <div className="value">{data.schedule.next_payday}</div>
                <div className="sub">
                  {data.schedule.frequency === "monthly" ? "Monthly" : "Every 14 days"} ·{" "}
                  {formatCurrency(data.schedule.expected_amount, currency)} expected (not yet received)
                </div>
              </>
            ) : (
              <>
                <div className="value">—</div>
                <div className="sub">No salary schedule set.</div>
              </>
            )}
          </div>
          <div className="card">
            <h2>Coming next</h2>
            <p className="center-note" style={{ padding: "8px 0" }}>
              Transactions, budgets, bills, your payday forecast, and the AI assistant arrive
              in the next updates. Your profile and salary schedule are saved.
            </p>
            <Link to="/settings" className="button button-secondary">
              Review your settings
            </Link>
          </div>
          {user && !profile?.display_name && (
            <div className="alert alert-info">
              Tip: add your display name in Settings so the dashboard feels personal.
            </div>
          )}
        </>
      )}
    </div>
  );
}
