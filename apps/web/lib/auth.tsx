"use client";

import {
  createApiClient,
  createAuthSession,
  restoreAuthSession,
  apiPaths,
  type AuthStorage,
} from "@task-marketplace/utils";
import type {
  AuthenticatedUser,
  AuthTokens,
} from "@task-marketplace/types";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const storage: AuthStorage = {
  async load() {
    if (typeof window === "undefined") return null;
    const refreshToken = window.sessionStorage.getItem("tm.refreshToken");
    return refreshToken ? { accessToken: "", refreshToken } : null;
  },
  async save(tokens) {
    if (typeof window === "undefined") return;
    if (tokens.refreshToken) window.sessionStorage.setItem("tm.refreshToken", tokens.refreshToken);
  },
  async clear() {
    if (typeof window !== "undefined") window.sessionStorage.removeItem("tm.refreshToken");
  },
};

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  api: ReturnType<typeof createApiClient>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromApi(value: unknown): AuthenticatedUser {
  const raw = value as Partial<AuthenticatedUser>;
  return {
    userId: String(raw.userId ?? ""),
    email: String(raw.email ?? ""),
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    status: raw.status,
  };
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Authentication failed.";
  const lower = message.toLowerCase();
  if (lower.includes("not active") || lower.includes("suspended")) {
    return "Your account is not active. Protected access is currently unavailable.";
  }
  if (lower.includes("banned")) {
    return "Your account is banned. Protected access is currently unavailable.";
  }
  if (lower.includes("deleted")) {
    return "Your account is deleted. Protected access is currently unavailable.";
  }
  if (lower.includes("invalid email") || lower.includes("invalid password")) {
    return "Invalid email or password.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "The service could not be reached. Check your connection and try again.";
  }
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getAccessToken: () => accessRef.current,
        refreshAccessToken: async () => {
          if (!refreshRef.current) return null;
          try {
            const response = await fetch(API_BASE_URL + apiPaths.refresh, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken: refreshRef.current }),
            });
            if (!response.ok) return null;
            const tokens = (await response.json()) as AuthTokens;
            accessRef.current = tokens.accessToken;
            refreshRef.current = tokens.refreshToken ?? refreshRef.current;
            await storage.save(tokens);
            return tokens.accessToken;
          } catch {
            return null;
          }
        },
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tokens = await restoreAuthSession(storage, createAuthSession(storage));
        if (!tokens?.refreshToken) return;
        const response = await fetch(API_BASE_URL + apiPaths.refresh, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
        if (!response.ok) throw new Error("Session expired");
        const nextTokens = (await response.json()) as AuthTokens;
        accessRef.current = nextTokens.accessToken;
        refreshRef.current = nextTokens.refreshToken ?? tokens.refreshToken;
        await storage.save(nextTokens);
        const current = await api<AuthenticatedUser>(apiPaths.me);
        if (!cancelled) setUser(userFromApi(current));
      } catch {
        accessRef.current = null;
        refreshRef.current = null;
        await storage.clear();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    if (loading) return;
    const publicPath = pathname === "/" || pathname === "/login" || pathname === "/register";
    if (!user && !publicPath) router.replace("/login");
    if (user && (pathname === "/login" || pathname === "/register" || pathname === "/")) {
      router.replace("/home");
    }
  }, [loading, pathname, router, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      api,
      async login(email, password) {
        setError(null);
        try {
          const tokens = await api<AuthTokens>(apiPaths.login, {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
          accessRef.current = tokens.accessToken;
          refreshRef.current = tokens.refreshToken ?? null;
          await storage.save(tokens);
          const current = await api<AuthenticatedUser>(apiPaths.me);
          setUser(userFromApi(current));
          router.replace("/home");
        } catch (cause) {
          setError(friendlyAuthError(cause));
          throw cause;
        }
      },
      async register(email, password) {
        setError(null);
        try {
          await api(apiPaths.register, {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
          router.replace("/login?registered=1");
        } catch (cause) {
          setError(friendlyAuthError(cause));
          throw cause;
        }
      },
      async refresh() {
        const current = await api<AuthenticatedUser>(apiPaths.me);
        setUser(userFromApi(current));
      },
      async logout() {
        accessRef.current = null;
        refreshRef.current = null;
        setUser(null);
        setError(null);
        await storage.clear();
        router.replace("/login");
      },
    }),
    [api, error, loading, router, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
