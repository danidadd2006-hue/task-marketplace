export type UserRole = 'CLIENT' | 'WORKER' | 'ADMIN';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: readonly UserRole[];
  status?: AccountStatus;
}
