import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CreateTaskDto } from './dto/create-task.dto.js';

describe('CreateTaskDto', () => {
  it('rejects clientId supplied in a task request body', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    await expect(pipe.transform({ categoryId: 'd5c0f2d4-5fc6-4e64-979d-106f9d79d1a0', title: 'Move sofa', description: 'Move a sofa safely.', type: 'VIRTUAL', duration: 'SHORT_TERM', clientId: 'other-client' }, { type: 'body', metatype: CreateTaskDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
