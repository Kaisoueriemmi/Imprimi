'use client';

import type { SessionResponse } from '@printbox/shared';
import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext } from 'react';
import { ApiRequestError } from './customer-api';

export interface CustomerContextValue {
  session: SessionResponse;
  /**
   * Turns a failed call into an error code to show next to the action. Returns null when the
   * session is gone: the whole app then shows "scan the QR code again".
   */
  handleError: (error: unknown) => string | null;
}

export const CustomerContext = createContext<CustomerContextValue | null>(null);

export function useCustomer(): CustomerContextValue {
  const value = useContext(CustomerContext);
  if (!value) throw new Error('useCustomer outside CustomerContext');
  return value;
}

export function errorCodeOf(error: unknown): string {
  return error instanceof ApiRequestError ? error.code : 'generic';
}

export function isSessionLost(code: string): boolean {
  return code === 'SESSION_EXPIRED' || code === 'UNAUTHORIZED';
}

/** Translated text of an API error code (generic message for codes without their own). */
export function useErrorText(): (code: string) => string {
  const t = useTranslations('customer.errors');
  return useCallback(
    (code: string) => {
      if (t.has(`conversion.${code}`)) return t(`conversion.${code}`);
      if (code !== 'conversion' && code !== 'retry' && t.has(code)) return t(code);
      return t('generic');
    },
    [t],
  );
}

export function formatPickupCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
