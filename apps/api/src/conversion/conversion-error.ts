import { ConversionErrorCode } from '@printbox/shared';

/** Expected conversion failure: the file is rejected with a code the customer is shown. */
export class ConversionError extends Error {
  constructor(
    readonly code: ConversionErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'ConversionError';
  }
}
