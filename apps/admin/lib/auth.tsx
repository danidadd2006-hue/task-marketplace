"use client";

import {
  apiPaths,
  createApiClient,
  type AuthStorage,
} from "@task-marketplace/utils";
import type { AuthenticatedUser, AuthTokens } from "@task-marketplace/types";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const storage: AuthStorage = {
  async load() {
    if (typeof window === "undefined") return null;
    const refreshToken = window.sessionStorage.getItem("tm.admin.refreshToken");
    return refreshToken ? { accessToken: "", refreshToken } : null;
  },
  async save(tokens) {
    if (typeof window !== "undefined" && tokens.refreshToken) {
      window.sessionStorage.setItem("tm.admin.refreshToken", tokens.refreshToken);
    }
  },
  async clear() {
    if (typeof window !== "undefined") window.sessionStorage.removeItem("tm.admin.refreshToken");
  },
};

interface AdminAuthValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  authorized: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  api: ReturnType<typeof createApiClient>;
}

const Context = createContext<AdminAuthValue | null>(null);

function normalize(value: unknown): AuthenticatedUser {
  const raw = value as Partial<AuthenticatedUser>;
  return {
    userId: String(raw.userId ?? ""),
    email: String(raw.email ?? ""),
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    status: raw.status,
  };
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(() => createApiClient({
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
        const tokens = await response.json() as AuthTokens;
        accessRef.current = tokens.accessToken;
        refreshRef.current = tokens.refreshToken ?? refreshRef.current;
        await storage.save(tokens);
        return tokens.accessToken;
      } catch {
        return null;
      }
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await storage.load();
        if (!stored?.refreshToken) return;
        const response = await fetch(API_BASE_URL + apiPaths.refresh, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: stored.refreshToken }),
        });
        if (!response.ok) throw new Error("Session expired");
        const tokens = await response.json() as AuthTokens;
        accessRef.current = tokens.accessToken;
        refreshRef.current = tokens.refreshToken ?? stored.refreshToken;
        await storage.save(tokens);
        const current = await api<AuthenticatedUser>(apiPaths.me);
        if (!cancelled) setUser(normalize(current));
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

  const authorized = user?.roles.includes("ADMIN") === true;

  useEffect(() => {
    if (loading) return;
    if (!user && pathname !== "/login") router.replace("/login");
    if (user && pathname === "/login") router.replace("/admin");
  }, [loading, pathname, router, user]);

  const value = useMemo<AdminAuthValue>(() => ({
    user,
    loading,
    error,
    authorized,
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
        const current = normalize(await api<AuthenticatedUser>(apiPaths.me));
        setUser(current);
        if (!current.roles.includes("ADMIN")) {
          throw new Error("Administrator authorization cannot be verified because the current /auth/me API response does not expose effective roles.");
        }
        router.replace("/admin");
      } catch (cause) {
        accessRef.current = null;
        refreshRef.current = null;
        await storage.clear();
        const message = cause instanceof Error ? cause.message : "Administrator sign-in failed.";
        setError(message);
        setUser(null);
        throw new Error(message);
      }
    },
    async logout() {
      accessRef.current = null;
      refreshRef.current = null;
      setUser(null);
      setError(null);
      await storage.clear();
      router.replace("/login");
    },
  }), [api, authorized, error, loading, router, user]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAdminAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return context;
}
