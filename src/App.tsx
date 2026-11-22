import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import ProtectedLayout from "./pages/ProtectedLayout";
import Dashboard from "./pages/Dashboard";
import Bills from "./pages/Bills";
import Budgets from "./pages/Budgets";
import Forecast from "./pages/Forecast";
import Assistant from "./pages/Assistant";
import Settings from "./pages/Settings";
import Transactions from "./pages/Transactions";
import LogIn from "./pages/LogIn";
import SignUp from "./pages/SignUp";
import OnboardingProfile from "./pages/onboarding/ProfileStep";
import OnboardingSalary from "./pages/onboarding/SalaryStep";
import OnboardingCash from "./pages/onboarding/CashStep";

function OnboardingLayout() {
  const { status } = useAuth();
  if (status === "loading") {
    return <div className="spinner" role="status" aria-label="Checking your session" />;
  }
  if (status === "signed-out") {
    return <Navigate to="/login" replace />;
  }
  return (
    <div className="auth-page">
      <div style={{ width: "100%", maxWidth: 520 }}>
        <Outlet />
      </div>
    </div>
  );
}

function AppRoutes() {
  const { status, signOut } = useAuth();

  // Supabase email-confirmation and password-recovery links return here with
  // the session in the URL fragment; detect it once and route to sign-in,
  // where the session is picked up normally.
  const [hashParams] = useState(() => new URLSearchParams(window.location.hash.replace(/^#/, "")));
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const comingFromEmailLink =
    hashParams.get("type") === "email" ||
    hashParams.get("type") === "recovery" ||
    searchParams.get("type") === "email" ||
    searchParams.get("type") === "recovery";
  const [emailLinkHandled, setEmailLinkHandled] = useState(false);

  useEffect(() => {
    if (comingFromEmailLink && !emailLinkHandled) {
      setEmailLinkHandled(true);
      // supabase-js detects the URL session on load; clear the fragment after
      // a short delay so a refresh doesn't reuse the one-time token.
      const timer = setTimeout(() => {
        history.replaceState(null, "", window.location.pathname);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [comingFromEmailLink, emailLinkHandled]);

  return (
    <div className="app-shell">
      {status === "ready" && (
        <header className="app-header">
          <span className="brand">aimass</span>
          <nav className="app-nav" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Dashboard
            </NavLink>
            <NavLink to="/transactions" className={({ isActive }) => (isActive ? "active" : "")}>
              Transactions
            </NavLink>
            <NavLink to="/budgets" className={({ isActive }) => (isActive ? "active" : "")}>
              Budgets
            </NavLink>
            <NavLink to="/bills" className={({ isActive }) => (isActive ? "active" : "")}>
              Bills
            </NavLink>
            <NavLink to="/forecast" className={({ isActive }) => (isActive ? "active" : "")}>
              Forecast
            </NavLink>
            <NavLink to="/assistant" className={({ isActive }) => (isActive ? "active" : "")}>
              AI Assistant
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
              Settings
            </NavLink>
            <button className="button button-ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </nav>
        </header>
      )}
      <main className={status === "ready" ? "app-main" : ""} style={status !== "ready" ? { flex: 1, display: "flex", flexDirection: "column" } : undefined}>
        <Routes>
          <Route path="/login" element={status === "signed-out" || comingFromEmailLink ? <LogIn /> : <Navigate to="/" replace />} />
          <Route path="/signup" element={status === "signed-out" ? <SignUp /> : <Navigate to="/" replace />} />
          <Route element={<OnboardingLayout />}>
            <Route path="/onboarding/profile" element={<OnboardingProfile />} />
            <Route path="/onboarding/salary" element={<OnboardingSalary />} />
            <Route path="/onboarding/cash" element={<OnboardingCash />} />
          </Route>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/forecast" element={<Forecast />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="app-footer">
        aimass — estimates and budgeting help, not professional financial advice.
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
