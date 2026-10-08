export function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export {
  ApiClientError,
  createApiClient,
  apiPaths,
} from "./api-client";
export type { ApiClientOptions } from "./api-client";
export {
  createAuthSession,
  restoreAuthSession,
} from "./auth-session";
export type { AuthStorage, AuthSession } from "./auth-session";
