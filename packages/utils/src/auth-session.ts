import type { AuthenticatedUser, AuthTokens } from "@task-marketplace/types";

export interface AuthStorage {
  load(): Promise<AuthTokens | null>;
  save(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

export interface AuthSession {
  getTokens(): AuthTokens | null;
  getUser(): AuthenticatedUser | null;
  setTokens(tokens: AuthTokens): void;
  setUser(user: AuthenticatedUser): void;
  clear(): Promise<void>;
}

export function createAuthSession(
  storage: AuthStorage,
  onChange?: () => void,
): AuthSession {
  let tokens: AuthTokens | null = null;
  let user: AuthenticatedUser | null = null;

  return {
    getTokens: () => tokens,
    getUser: () => user,
    setTokens(next) {
      tokens = next;
      void storage.save(next);
      onChange?.();
    },
    setUser(next) {
      user = next;
      onChange?.();
    },
    async clear() {
      tokens = null;
      user = null;
      await storage.clear();
      onChange?.();
    },
  };
}

export async function restoreAuthSession(
  storage: AuthStorage,
  session: AuthSession,
): Promise<AuthTokens | null> {
  const tokens = await storage.load();
  if (!tokens?.accessToken) return null;
  session.setTokens(tokens);
  return tokens;
}
