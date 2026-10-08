export type MarketplaceSide = "CLIENT" | "WORKER";
export type UserRole = "CLIENT" | "WORKER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";

export type TaskType = "PHYSICAL" | "VIRTUAL";
export type TaskDuration = "SHORT_TERM" | "LONG_TERM";
export type PublicTaskStatus = "PUBLISHED" | "RECEIVING_APPLICATIONS";

export interface PublicTaskDetails {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  duration: TaskDuration;
  status: PublicTaskStatus;
  currency: string;
  budgetMin: string | null;
  budgetMax: string | null;
  expectedCompletionAt: string | null;
  requirements: string | null;
  createdAt: string;
  updatedAt: string;
  category: {
    id: string;
    name: string;
  };
  requirementsList: Array<{
    id: string;
    taskId: string;
    name: string;
    value: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  attachments: Array<{
    id: string;
    taskId: string;
    fileName: string | null;
    fileType: string | null;
    fileSize: number | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

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
