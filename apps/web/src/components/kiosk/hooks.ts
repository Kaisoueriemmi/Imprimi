'use client';

import {
  KioskEvent,
  type KioskScreenState,
  kioskScreenStateSchema,
  type QrTokenResponse,
  qrTokenResponseSchema,
  SocketNamespace,
} from '@printbox/shared';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '@/lib/env';

const QR_RETRY_MS = 10_000;

export type QrState =
  | { status: 'loading' }
  | { status: 'ready'; qr: QrTokenResponse }
  | { status: 'unauthorized' }
  | { status: 'error' };

/**
 * Asks the API for a fresh signed QR token every 60 s (it lives 90 s). On a network error the
 * current token is kept while still valid, and the request is retried every 10 s.
 */
export function useQrToken(kioskId: string, displayKey: string | null, enabled: boolean): QrState {
  const [state, setState] = useState<QrState>({ status: 'loading' });

  useEffect(() => {
    if (!displayKey || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async (): Promise<void> => {
      try {
        const res = await fetch(`${API_URL}/api/kiosks/${encodeURIComponent(kioskId)}/qr-token`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${displayKey}` },
          cache: 'no-store',
        });
        if (res.status === 401) {
          if (!cancelled) setState({ status: 'unauthorized' });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const qr = qrTokenResponseSchema.parse(await res.json());
        if (cancelled) return;
        setState({ status: 'ready', qr });
        timer = setTimeout(() => void refresh(), qr.refreshInMs);
      } catch {
        if (cancelled) return;
        setState((previous) =>
          previous.status === 'ready' && Date.parse(previous.qr.expiresAt) > Date.now()
            ? previous
            : { status: 'error' },
        );
        timer = setTimeout(() => void refresh(), QR_RETRY_MS);
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kioskId, displayKey, enabled]);

  return state;
}

export interface LiveKioskState {
  state: KioskScreenState | null;
  connected: boolean;
  /** Since when the API is unreachable (null while connected). */
  disconnectedSince: number | null;
  unauthorized: boolean;
}

/** Live screen state pushed by the API on the `/kiosks` namespace (reconnects by itself). */
export function useKioskState(kioskId: string, displayKey: string | null): LiveKioskState {
  const [live, setLive] = useState<LiveKioskState>({
    state: null,
    connected: false,
    disconnectedSince: null,
    unauthorized: false,
  });

  useEffect(() => {
    if (!displayKey) return;
    const socket = io(`${API_URL}${SocketNamespace.KIOSKS}`, {
      auth: { kioskId, displayKey },
      transports: ['websocket'],
      reconnectionDelayMax: 10_000,
    });
    socket.on('connect', () =>
      setLive((s) => ({ ...s, connected: true, disconnectedSince: null, unauthorized: false })),
    );
    socket.on('disconnect', () =>
      setLive((s) => ({
        ...s,
        connected: false,
        disconnectedSince: s.disconnectedSince ?? Date.now(),
      })),
    );
    socket.on('connect_error', (error) =>
      setLive((s) => ({
        ...s,
        connected: false,
        disconnectedSince: s.disconnectedSince ?? Date.now(),
        unauthorized: error.message === 'unauthorized',
      })),
    );
    socket.on(KioskEvent.STATE, (raw: unknown) => {
      const parsed = kioskScreenStateSchema.safeParse(raw);
      if (parsed.success) setLive((s) => ({ ...s, state: parsed.data }));
    });
    return () => {
      socket.disconnect();
    };
  }, [kioskId, displayKey]);

  return live;
}

/** Current time, refreshed every `intervalMs` (countdowns). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
