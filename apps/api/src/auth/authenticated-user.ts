export type UserRole = 'CLIENT' | 'WORKER' | 'ADMIN';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: readonly UserRole[];
}
