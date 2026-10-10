import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  where: vi.fn(), select: vi.fn(), orderBy: vi.fn(), all: vi.fn(),
}));

vi.mock("../prisma/db.js", () => ({
  db: { orm: { public: { Category: { where: mocks.where } } } },
}));

import { PublicCategoriesService } from "./public-categories.service.js";

describe("PublicCategoriesService", () => {
  const service = new PublicCategoriesService();
  beforeEach(() => {
    vi.resetAllMocks();
    const chain = { where: mocks.where, select: mocks.select, orderBy: mocks.orderBy, all: mocks.all };
    mocks.where.mockReturnValue(chain);
    mocks.select.mockReturnValue(chain);
    mocks.orderBy.mockReturnValue(chain);
    mocks.all.mockResolvedValue([{ id: "category-id", name: "Moving" }]);
  });

  it("returns only active category ids and names in stable order", async () => {
    const result = await service.listActiveCategories();
    expect(mocks.where).toHaveBeenCalledWith(expect.any(Function));
    const activeEq = vi.fn();
    mocks.where.mock.calls[0][0]({ active: { eq: activeEq } });
    expect(activeEq).toHaveBeenCalledWith(true);
    expect(mocks.select).toHaveBeenCalledWith("id", "name");
    expect(mocks.orderBy).toHaveBeenCalledWith([expect.any(Function), expect.any(Function)]);
    expect(result).toEqual([{ id: "category-id", name: "Moving" }]);
  });
});
