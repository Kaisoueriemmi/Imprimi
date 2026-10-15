import { PipeTransform } from '@nestjs/common';
import { ApiErrorCode } from '@printbox/shared';
import { z } from 'zod';
import { ApiException } from './api-exception';

/** Validates (and types) a request part against a shared Zod schema: `@Body(new ZodValidationPipe(schema))`. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiException(
        400,
        ApiErrorCode.VALIDATION_FAILED,
        z.prettifyError(result.error).slice(0, 500),
      );
    }
    return result.data;
  }
}
