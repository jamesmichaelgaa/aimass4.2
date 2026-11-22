import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import ProtectedLayout from "./pages/ProtectedLayout";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
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

  return (
    <div className="app-shell">
      {status === "ready" && (
        <header className="app-header">
          <span className="brand">aimass</span>
          <nav className="app-nav" aria-label="Primary">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Dashboard
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
          <Route path="/login" element={status === "signed-out" ? <LogIn /> : <Navigate to="/" replace />} />
          <Route path="/signup" element={status === "signed-out" ? <SignUp /> : <Navigate to="/" replace />} />
          <Route element={<OnboardingLayout />}>
            <Route path="/onboarding/profile" element={<OnboardingProfile />} />
            <Route path="/onboarding/salary" element={<OnboardingSalary />} />
            <Route path="/onboarding/cash" element={<OnboardingCash />} />
          </Route>
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<Dashboard />} />
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
