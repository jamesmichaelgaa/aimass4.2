import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

// A signed-in user reaches the dashboard only when the salary step of
// onboarding is done; the cash step can be completed from the dashboard.
// Row level security scopes this query to the signed-in user's own rows.
async function hasActiveSchedule(): Promise<boolean> {
  const { data, error } = await supabase
    .from("income_schedules")
    .select("id")
    .eq("is_active", true)
    .limit(1);
  if (error) {
    return false;
  }
  return (data ?? []).length > 0;
}

export default function ProtectedLayout() {
  const { status, user } = useAuth();
  const [checkingSchedule, setCheckingSchedule] = useState(true);
  const [needsSchedule, setNeedsSchedule] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (status !== "ready" || !user) {
      setCheckingSchedule(false);
      return;
    }
    hasActiveSchedule()
      .then((has) => {
        if (!cancelled) {
          setNeedsSchedule(!has);
          setCheckingSchedule(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNeedsSchedule(true);
          setCheckingSchedule(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, user]);

  if (status === "loading") {
    return <div className="spinner" role="status" aria-label="Checking your session" />;
  }
  if (status === "signed-out") {
    return <Navigate to="/login" replace />;
  }
  if (status === "onboarding") {
    return <Navigate to="/onboarding/profile" replace />;
  }
  if (checkingSchedule) {
    return <div className="spinner" role="status" aria-label="Checking your setup" />;
  }
  if (needsSchedule) {
    return <Navigate to="/onboarding/salary" replace />;
  }
  return <Outlet />;
}
