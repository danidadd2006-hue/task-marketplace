import { describe, expect, it, vi } from 'vitest';
import { PublicCategoriesController } from './public-categories.controller.js';

describe('PublicCategoriesController', () => {
  it('delegates category listing to the service', async () => {
    const categories = [{ id: 'category-id', name: 'Moving' }];
    const service = { listActiveCategories: vi.fn().mockResolvedValue(categories) };
    const controller = new PublicCategoriesController(service as never);

    await expect(controller.listActiveCategories()).resolves.toEqual(categories);
    expect(service.listActiveCategories).toHaveBeenCalledOnce();
  });
});
