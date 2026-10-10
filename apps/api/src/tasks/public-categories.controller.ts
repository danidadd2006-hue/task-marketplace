import { Controller, Get } from '@nestjs/common';
import { PublicCategoriesService } from './public-categories.service.js';

@Controller('api/v1/categories')
export class PublicCategoriesController {
  constructor(private readonly categoriesService: PublicCategoriesService) {}

  @Get()
  listActiveCategories() {
    return this.categoriesService.listActiveCategories();
  }
}
