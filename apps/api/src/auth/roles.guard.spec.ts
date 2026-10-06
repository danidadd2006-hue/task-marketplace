import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';

describe('RolesGuard', () => {
  it('denies a worker when a route requires the client role', () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => ['CLIENT']),
    } as unknown as Reflector;
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'worker-id', email: 'worker@example.com', roles: ['WORKER'] } }),
      }),
    } as unknown as ExecutionContext;

    expect(new RolesGuard(reflector).canActivate(context)).toBe(false);
  });

  it('allows a user with both CLIENT and WORKER assignments', () => {
    const reflector = { getAllAndOverride: vi.fn(() => ['CLIENT']) } as unknown as Reflector;
    const context = { getHandler: () => undefined, getClass: () => undefined, switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'both-id', email: 'both@example.com', roles: ['CLIENT', 'WORKER'] } }) }) } as unknown as ExecutionContext;
    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });
});
