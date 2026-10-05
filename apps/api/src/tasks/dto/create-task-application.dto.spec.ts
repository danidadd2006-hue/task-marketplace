import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateTaskApplicationDto } from './create-task-application.dto.js';

describe('CreateTaskApplicationDto', () => {
  it('requires proposedPrice', async () => {
    const dto = plainToInstance(CreateTaskApplicationDto, {});
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'proposedPrice')).toBe(true);
  });

  it('rejects invalid proposed prices', async () => {
    const dto = plainToInstance(CreateTaskApplicationDto, {
      proposedPrice: -1,
    });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'proposedPrice')).toBe(true);
  });

  it('rejects malformed optional data', async () => {
    const dto = plainToInstance(CreateTaskApplicationDto, {
      proposedPrice: 50,
      estimatedCompletionAt: 'not-a-date',
      message: '',
      attachments: [{ fileUrl: 'not-a-url' }],
    });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'estimatedCompletionAt')).toBe(true);
    expect(errors.some((error) => error.property === 'message')).toBe(true);

    const attachmentError = errors.find((error) => error.property === 'attachments');
    expect(attachmentError).toBeDefined();
    expect(attachmentError?.children?.length).toBeGreaterThan(0);
  });
});
