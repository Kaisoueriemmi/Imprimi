import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ApiError, ApiErrorCode } from '@printbox/shared';
import type { Response } from 'express';
import { ApiException } from './api-exception';

const GENERIC_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_FAILED: 'Requête invalide',
  UNAUTHORIZED: 'Non autorisé',
  NOT_FOUND: 'Introuvable',
  RATE_LIMITED: 'Trop de requêtes, réessayez dans un instant',
  INTERNAL: 'Erreur interne, réessayez',
  QR_EXPIRED: 'Rescannez le QR sur la borne',
  SESSION_EXPIRED: 'Session expirée. Rescannez le QR sur la borne',
  TOO_MANY_JOBS: 'Nombre maximal de documents atteint',
  FILE_MISSING: 'Aucun fichier reçu',
  FILE_TOO_LARGE: 'Fichier trop volumineux',
  UNSUPPORTED_FILE_TYPE: 'Format non pris en charge',
  JOB_NOT_READY: 'Le document est encore en préparation',
  INVALID_JOB_STATE: "Action impossible dans l'état actuel du document",
  INVALID_PAGE_RANGE: 'Pages invalides',
  OPTION_UNAVAILABLE: 'Option indisponible sur cette borne',
  PRICING_UNAVAILABLE: 'Tarif non configuré',
  PAYMENT_METHOD_UNAVAILABLE: 'Moyen de paiement indisponible',
  KIOSK_BUSY: 'La borne est occupée, réessayez dans un instant',
};

function codeForStatus(status: number): ApiErrorCode {
  if (status === 401 || status === 403) return ApiErrorCode.UNAUTHORIZED;
  if (status === 404) return ApiErrorCode.NOT_FOUND;
  if (status === 413) return ApiErrorCode.FILE_TOO_LARGE;
  if (status === 429) return ApiErrorCode.RATE_LIMITED;
  if (status < 500) return ApiErrorCode.VALIDATION_FAILED;
  return ApiErrorCode.INTERNAL;
}

/**
 * Normalises every HTTP error to `{ statusCode, code, message }`. Framework messages are replaced
 * by generic ones: Nest's default 404 echoes the URL, query string (and thus tokens) included.
 */
export function toApiError(exception: unknown): ApiError {
  if (exception instanceof ApiException) return exception.body;
  if (exception instanceof ThrottlerException) {
    return {
      statusCode: 429,
      code: ApiErrorCode.RATE_LIMITED,
      message: GENERIC_MESSAGES.RATE_LIMITED,
    };
  }
  const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
  const code = codeForStatus(statusCode);
  return { statusCode, code, message: GENERIC_MESSAGES[code] };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = toApiError(exception);
    if (body.statusCode >= 500) {
      this.logger.error({ err: exception }, 'Unhandled error');
    }
    host.switchToHttp().getResponse<Response>().status(body.statusCode).json(body);
  }
}
