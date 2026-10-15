import { HttpException } from '@nestjs/common';
import { ApiError, ApiErrorCode } from '@printbox/shared';

/** HTTP error with the `{ statusCode, code, message }` body every client relies on. */
export class ApiException extends HttpException {
  readonly body: ApiError;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    const body: ApiError = { statusCode, code, message };
    super(body, statusCode);
    this.body = body;
  }
}

export const RESCAN_QR_MESSAGE = 'Rescannez le QR sur la borne';

export const qrExpired = (): ApiException =>
  new ApiException(401, ApiErrorCode.QR_EXPIRED, RESCAN_QR_MESSAGE);

export const sessionExpired = (): ApiException =>
  new ApiException(401, ApiErrorCode.SESSION_EXPIRED, `Session expirée. ${RESCAN_QR_MESSAGE}`);

export const notFound = (): ApiException =>
  new ApiException(404, ApiErrorCode.NOT_FOUND, 'Introuvable');

export const unauthorized = (): ApiException =>
  new ApiException(401, ApiErrorCode.UNAUTHORIZED, 'Non autorisé');
