import { Injectable } from '@nestjs/common';
import { db } from '../prisma/db.js';

@Injectable()
export class PublicCategoriesService {
  async listActiveCategories() {
    return db.orm.public.Category
      .where((category) => category.active.eq(true))
      .select('id', 'name')
      .orderBy([(category) => category.name.asc(), (category) => category.id.asc()])
      .all();
  }
}
