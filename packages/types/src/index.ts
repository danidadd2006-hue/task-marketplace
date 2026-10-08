export type MarketplaceSide = "CLIENT" | "WORKER";
export type UserRole = "CLIENT" | "WORKER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: UserRole[];
  status?: AccountStatus;
}

export interface ApiError {
  statusCode?: number;
  message: string | string[];
  error?: string;
}

export type ApiResult<T> = T;
