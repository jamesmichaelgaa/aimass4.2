import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile } from "./types";

type AuthStatus = "loading" | "signed-out" | "onboarding" | "ready";

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  markOnboarded: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, preferred_currency, timezone")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data ?? null;
}

// The signup trigger creates the profile row; new accounts may need a moment
// for the trigger to finish, so retry briefly before concluding it is missing.
async function loadProfileWithRetry(userId: string): Promise<Profile | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const profile = await loadProfile(userId);
    if (profile) {
      return profile;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return loadProfile(userId);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const resolveStatus = useCallback(
    (currentSession: Session | null, currentProfile: Profile | null): AuthStatus => {
      if (!currentSession) {
        return "signed-out";
      }
      if (!currentProfile) {
        return "onboarding";
      }
      return "ready";
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession()
      .then(async ({ data }) => {
        if (cancelled) {
          return;
        }
        const currentSession = data.session;
        setSession(currentSession);
        if (currentSession?.user) {
          try {
            const loaded = await loadProfileWithRetry(currentSession.user.id);
            if (cancelled) {
              return;
            }
            setProfile(loaded);
            setStatus(resolveStatus(currentSession, loaded));
          } catch {
            if (!cancelled) {
              setProfile(null);
              setStatus("onboarding");
            }
          }
        } else {
          setStatus("signed-out");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("signed-out");
        }
      });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) {
        return;
      }
      setSession(nextSession);
      if (event === "SIGNED_OUT" || !nextSession) {
        setProfile(null);
        setStatus("signed-out");
        return;
      }
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "TOKEN_REFRESHED") {
        void (async () => {
          try {
            const loaded = nextSession?.user
              ? await loadProfileWithRetry(nextSession.user.id)
              : null;
            if (cancelled) {
              return;
            }
            setProfile(loaded);
            setStatus(resolveStatus(nextSession, loaded));
          } catch {
            if (!cancelled) {
              setProfile(null);
              setStatus("onboarding");
            }
          }
        })();
      }
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [resolveStatus]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setStatus("signed-out");
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) {
      return;
    }
    const loaded = await loadProfile(session.user.id);
    setProfile(loaded);
    setStatus(resolveStatus(session, loaded));
  }, [session, resolveStatus]);

  const markOnboarded = useCallback(() => {
    setStatus("ready");
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      profile,
      signOut,
      refreshProfile,
      markOnboarded,
    }),
    [status, session, profile, signOut, refreshProfile, markOnboarded]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
