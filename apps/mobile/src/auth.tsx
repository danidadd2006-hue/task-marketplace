import * as SecureStore from "expo-secure-store";
import {
  apiPaths,
  createApiClient,
  createAuthSession,
  restoreAuthSession,
  type AuthStorage,
} from "@task-marketplace/utils";
import type { AuthenticatedUser, AuthTokens } from "@task-marketplace/types";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

declare const process: { env: Record<string, string | undefined> };
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
const REFRESH_KEY = "task-marketplace.refresh-token";

const storage: AuthStorage = {
  async load() {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    return refreshToken ? { accessToken: "", refreshToken } : null;
  },
  async save(tokens) {
    if (tokens.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
  },
  async clear() {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  api: ReturnType<typeof createApiClient>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeUser(value: unknown): AuthenticatedUser {
  const raw = value as Partial<AuthenticatedUser>;
  return {
    userId: String(raw.userId ?? ""),
    email: String(raw.email ?? ""),
    roles: Array.isArray(raw.roles) ? raw.roles : [],
    status: raw.status,
  };
}

function authError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Authentication failed.";
  const lower = message.toLowerCase();
  if (lower.includes("not active")) return "Your account is not active.";
  if (lower.includes("banned")) return "Your account is banned.";
  if (lower.includes("deleted")) return "Your account is deleted.";
  if (lower.includes("invalid email") || lower.includes("invalid password")) return "Invalid email or password.";
  if (lower.includes("network") || lower.includes("failed to fetch")) return "The service could not be reached.";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const api = useMemo(
    () => createApiClient({
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
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bootstrap = createAuthSession(storage);
        const stored = await restoreAuthSession(storage, bootstrap);
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
        if (!cancelled) setUser(normalizeUser(current));
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

  const value = useMemo<AuthContextValue>(() => ({
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
        setUser(normalizeUser(await api<AuthenticatedUser>(apiPaths.me)));
      } catch (cause) {
        const message = authError(cause);
        setError(message);
        throw new Error(message);
      }
    },
    async register(email, password) {
      setError(null);
      try {
        await api(apiPaths.register, {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      } catch (cause) {
        const message = authError(cause);
        setError(message);
        throw new Error(message);
      }
    },
    async logout() {
      accessRef.current = null;
      refreshRef.current = null;
      setUser(null);
      setError(null);
      await storage.clear();
    },
  }), [api, error, loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
