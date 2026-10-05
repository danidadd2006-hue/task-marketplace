import { describe, expect, it, vi } from 'vitest';
import { PublicTasksController } from './public-tasks.controller.js';

describe('PublicTasksController', () => {
  it('delegates feed discovery without role guards', async () => {
    const discovery = {
      discoverTasks: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, hasMore: false }),
    };
    const controller = new PublicTasksController(discovery as never);

    await controller.discoverTasks({});

    expect(discovery.discoverTasks).toHaveBeenCalledWith({});
  });
});
