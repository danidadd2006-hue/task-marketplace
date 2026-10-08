import type { ApiError } from "@task-marketplace/types";

const joinUrl = (base: string, path: string) =>
  (base.endsWith("/") ? base.slice(0, -1) : base) +
  "/" +
  (path.startsWith("/") ? path.slice(1) : path);

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: unknown = null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined;
  refreshAccessToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

function errorMessage(data: unknown, status: number): string {
  const error = data as Partial<ApiError>;
  if (Array.isArray(error?.message)) return error.message.join(", ");
  if (typeof error?.message === "string") return error.message;
  if (typeof data === "string" && data.trim()) return data;
  return `API request failed (${status})`;
}

export function createApiClient(options: ApiClientOptions) {
  const fetcher = options.fetchImpl ?? fetch;

  return async function request<T>(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const token = options.getAccessToken?.();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetcher(joinUrl(options.baseUrl, path), {
      ...init,
      headers,
    });

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (response.status === 401 && retry && options.refreshAccessToken) {
      const refreshedToken = await options.refreshAccessToken();
      if (refreshedToken) {
        return request<T>(path, init, false);
      }
    }

    if (!response.ok) {
      throw new ApiClientError(
        errorMessage(data, response.status),
        response.status,
        data,
      );
    }

    return data as T;
  };
}

export const apiPaths = {
  register: "/api/v1/auth/register",
  login: "/api/v1/auth/login",
  refresh: "/api/v1/auth/refresh",
  me: "/api/v1/auth/me",
} as const;
