'use client';

import type { JobView, SessionResponse } from '@printbox/shared';
import { Printer, QrCode, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { customerApi } from './customer-api';
import {
  CustomerContext,
  type CustomerContextValue,
  errorCodeOf,
  isSessionLost,
  useErrorText,
} from './customer-context';
import { JobFlow } from './job-flow';
import { LanguageSwitcher } from './language-switcher';
import { browserStorage, clearSession, loadSession, saveSession } from './session-store';
import { UploadStep } from './upload-step';

type Phase =
  | { kind: 'connecting' }
  | { kind: 'blocked'; code: string; retry?: () => void }
  | { kind: 'ready'; session: SessionResponse; job: JobView | null; started: boolean };

function Shell({ kioskName, children }: { kioskName?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Printer aria-hidden className="size-6 shrink-0 text-amber-400" />
            <span className="font-bold">PrintBox</span>
            {kioskName && (
              <span className="hidden truncate text-sm text-slate-300 sm:inline">
                · {kioskName}
              </span>
            )}
          </div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-5">
        {children}
      </main>
    </div>
  );
}

function Welcome({ session, onStart }: { session: SessionResponse; onStart: () => void }) {
  const t = useTranslations('customer.welcome');
  return (
    <Card className="flex flex-col gap-5">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p className="text-slate-600">{t('kiosk', { name: session.kiosk.name })}</p>
      <p className="text-lg">{t('steps')}</p>
      <Button size="lg" variant="accent" block onClick={onStart}>
        {t('start')}
      </Button>
      <p className="flex items-start gap-2 text-sm text-slate-600">
        <ShieldCheck aria-hidden className="size-5 shrink-0 text-emerald-600" />
        {t('privacy')}
      </p>
    </Card>
  );
}

/**
 * The customer's phone, opened by scanning the kiosk QR code (`/k/<kioskId>?t=<token>`). The
 * one-time token is exchanged for a session, then removed from the address bar; the session is
 * kept in tab storage so a reload resumes where the customer was.
 */
export function CustomerApp({ kioskId }: { kioskId: string }) {
  const t = useTranslations('customer');
  const errorText = useErrorText();
  const [phase, setPhase] = useState<Phase>({ kind: 'connecting' });
  const booted = useRef(false);

  const boot = useCallback(
    async (token: string | null): Promise<void> => {
      setPhase({ kind: 'connecting' });
      const storage = browserStorage();
      const stored = loadSession(storage, kioskId, Date.now());
      if (stored) {
        let job: JobView | null = null;
        let lost = false;
        if (stored.jobId) {
          try {
            job = await customerApi.getJob(stored.session.sessionToken, stored.jobId);
          } catch (failure) {
            const code = errorCodeOf(failure);
            if (code === 'NETWORK') {
              setPhase({ kind: 'blocked', code, retry: () => void boot(token) });
              return;
            }
            lost = isSessionLost(code);
            if (lost) clearSession(storage, kioskId);
          }
        }
        if (!lost) {
          setPhase({ kind: 'ready', session: stored.session, job, started: true });
          return;
        }
      }
      if (!token) {
        setPhase({ kind: 'blocked', code: stored ? 'SESSION_EXPIRED' : 'QR_EXPIRED' });
        return;
      }
      try {
        const session = await customerApi.createSession(kioskId, token);
        saveSession(storage, kioskId, { session, jobId: null });
        setPhase({ kind: 'ready', session, job: null, started: false });
      } catch (failure) {
        const code = errorCodeOf(failure);
        const retryable = code === 'NETWORK' || code === 'RATE_LIMITED' || code === 'generic';
        setPhase({ kind: 'blocked', code, retry: retryable ? () => void boot(token) : undefined });
      }
    },
    [kioskId],
  );

  useEffect(() => {
    if (booted.current) return; // React strict mode runs effects twice in development
    booted.current = true;
    const url = new URL(window.location.href);
    const token = url.searchParams.get('t');
    if (token) {
      url.searchParams.delete('t');
      // `null` state: Next.js then syncs its router to the cleaned URL (a later router.refresh,
      // e.g. from the language switcher, would otherwise put the token back).
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    void boot(token);
  }, [boot]);

  const showJob = useCallback((job: JobView | null) => {
    setPhase((current) => {
      if (current.kind !== 'ready') return current;
      return { ...current, job, started: true };
    });
  }, []);

  // Remembers the followed job, so a reload resumes it.
  const readySession = phase.kind === 'ready' ? phase.session : null;
  const readyJobId = phase.kind === 'ready' ? (phase.job?.id ?? null) : null;
  useEffect(() => {
    if (readySession)
      saveSession(browserStorage(), kioskId, { session: readySession, jobId: readyJobId });
  }, [kioskId, readySession, readyJobId]);

  const handleError = useCallback(
    (failure: unknown): string | null => {
      const code = errorCodeOf(failure);
      if (!isSessionLost(code)) return code;
      clearSession(browserStorage(), kioskId);
      setPhase({ kind: 'blocked', code: 'SESSION_EXPIRED' });
      return null;
    },
    [kioskId],
  );

  const context = useMemo<CustomerContextValue | null>(
    () => (readySession ? { session: readySession, handleError } : null),
    [readySession, handleError],
  );

  if (phase.kind === 'connecting') {
    return (
      <Shell>
        <p role="status" className="py-16 text-center text-slate-600">
          {t('loading')}
        </p>
      </Shell>
    );
  }

  if (phase.kind === 'blocked' || !context) {
    const code = phase.kind === 'blocked' ? phase.code : 'generic';
    const retry = phase.kind === 'blocked' ? phase.retry : undefined;
    return (
      <Shell>
        <Card className="flex flex-col items-center gap-4 py-8 text-center">
          <QrCode aria-hidden className="size-16 text-slate-400" />
          <p role="alert" className="text-lg font-semibold">
            {errorText(code)}
          </p>
          {retry && (
            <Button block onClick={retry}>
              {t('errors.retry')}
            </Button>
          )}
        </Card>
      </Shell>
    );
  }

  return (
    <CustomerContext.Provider value={context}>
      <Shell kioskName={context.session.kiosk.name}>
        {!phase.started ? (
          <Welcome session={context.session} onStart={() => showJob(null)} />
        ) : phase.job ? (
          <JobFlow key={phase.job.id} initial={phase.job} onRestart={() => showJob(null)} />
        ) : (
          <UploadStep onUploaded={(job) => showJob(job)} />
        )}
      </Shell>
    </CustomerContext.Provider>
  );
}
