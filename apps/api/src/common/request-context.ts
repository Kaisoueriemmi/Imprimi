import type { Request } from 'express';

/** Customer session resolved by SessionGuard. */
export interface PrintSessionContext {
  id: string;
  kioskId: string;
}

/** Request enriched by the guards. */
export type AppRequest = Request & {
  printSession?: PrintSessionContext;
  /** Kiosk authenticated by its display key (KioskDisplayGuard). */
  kiosk?: { id: string };
};

/** Value of `Authorization: Bearer <token>`, or null. */
export function bearerToken(req: Pick<Request, 'headers'>): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 && token.length <= 4096 ? token : null;
}
