'use client';

import { formatMillimes, type KioskScreenState } from '@printbox/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { coinProgress, msUntilNextReload, resolveDisplayKey, secondsLeft } from '@/lib/kiosk';
import { KIOSK_COPY, type Trilingual } from './copy';
import { useKioskState, useNow, useQrToken } from './hooks';
import { QrCode } from './qr-code';

/** A short API outage (deploy, Wi-Fi hiccup) does not flash "out of service". */
const API_UNREACHABLE_GRACE_MS = 30_000;

/** French, Arabic (right-to-left) and English, stacked. */
function Tri({ text, className = '' }: { text: Trilingual; className?: string }) {
  return (
    <div className={className}>
      <p>{text.fr}</p>
      <p dir="rtl" lang="ar" className="font-arabic">
        {text.ar}
      </p>
      <p className="opacity-70">{text.en}</p>
    </div>
  );
}

function Steps() {
  const { steps } = KIOSK_COPY;
  const block = (lines: readonly string[], lang: 'fr' | 'ar' | 'en') => (
    <ol
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      className={`space-y-2 text-[clamp(1rem,1.6vw,1.6rem)] ${lang === 'ar' ? 'font-arabic' : ''} ${
        lang === 'en' ? 'text-slate-400' : ''
      }`}
    >
      {lines.map((line, index) => (
        <li key={line} className="flex items-start gap-3">
          <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400 text-base font-bold text-slate-950">
            {index + 1}
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ol>
  );
  return (
    <div className="grid gap-6">
      {block(steps.fr, 'fr')}
      {block(steps.ar, 'ar')}
      {block(steps.en, 'en')}
    </div>
  );
}

function Queue({ queue }: { queue: KioskScreenState['queue'] }) {
  return (
    <section aria-live="polite">
      <h2 className="mb-3 text-xl font-semibold text-slate-300">
        {KIOSK_COPY.queueTitle.fr} · <span className="font-arabic">{KIOSK_COPY.queueTitle.ar}</span>{' '}
        · {KIOSK_COPY.queueTitle.en}
      </h2>
      {queue.length === 0 ? (
        <p className="text-lg text-slate-500">
          {KIOSK_COPY.queueEmpty.fr} ·{' '}
          <span className="font-arabic">{KIOSK_COPY.queueEmpty.ar}</span>
        </p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {queue.map((job, index) => {
            const status = KIOSK_COPY.jobStatus[job.status];
            const printing = job.status === 'PRINTING';
            return (
              <li
                key={`${job.codeHint}-${index}`}
                className={`rounded-2xl px-5 py-3 text-xl ${
                  printing ? 'bg-emerald-500 text-slate-950' : 'bg-white/10 text-white'
                }`}
              >
                <span className="font-mono text-2xl font-bold tracking-widest">{job.codeHint}</span>
                <span className="ms-3">
                  {status.fr} · <span className="font-arabic">{status.ar}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Overlay({ children, tone }: { children: ReactNode; tone: 'coin' | 'error' }) {
  return (
    <div
      className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-[3vh] p-[4vmin] text-center ${
        tone === 'coin' ? 'bg-slate-950/95' : 'bg-red-950'
      }`}
      role="status"
    >
      {children}
    </div>
  );
}

function CoinPayment({
  payment,
  now,
}: {
  payment: NonNullable<KioskScreenState['coinPayment']>;
  now: number;
}) {
  const { remainingMillimes, percent } = coinProgress(payment);
  return (
    <Overlay tone="coin">
      <Tri
        text={KIOSK_COPY.insertCoins}
        className="space-y-2 text-[clamp(2rem,4vw,4rem)] font-bold"
      />
      <div>
        <p className="text-2xl text-slate-300">
          {KIOSK_COPY.remaining.fr} · <span className="font-arabic">{KIOSK_COPY.remaining.ar}</span>
        </p>
        <p className="font-mono text-[clamp(4rem,10vw,9rem)] font-black text-amber-400">
          {formatMillimes(remainingMillimes)}
        </p>
      </div>
      <div className="h-6 w-[min(80vw,900px)] shrink-0 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-amber-400 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-2xl text-slate-300">
        {KIOSK_COPY.received.fr} {formatMillimes(payment.receivedMillimes)} /{' '}
        {formatMillimes(payment.amountDueMillimes)} · {payment.codeHint} ·{' '}
        {secondsLeft(payment.expiresAt, now)} s
      </p>
      <Tri text={KIOSK_COPY.changeGiven} className="text-xl text-emerald-300" />
    </Overlay>
  );
}

function SetupNeeded({ kioskId }: { kioskId: string }) {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-slate-950 p-12 text-center text-white">
      <h1 className="text-4xl font-bold">Écran de borne non configuré</h1>
      <p className="max-w-2xl text-xl text-slate-300">
        Ouvrez cette page une fois avec la clé d&apos;écran de la borne :{' '}
        <code className="rounded bg-white/10 px-2 py-1">/kiosk/{kioskId}#key=pbd_…</code>. Elle est
        ensuite mémorisée sur ce PC.
      </p>
    </main>
  );
}

/** Keeps the monitor awake, re-acquiring the lock when the page becomes visible again. */
function useScreenWakeLock(): void {
  useEffect(() => {
    type Sentinel = { release(): Promise<void> };
    const wakeLock = (
      navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }
    ).wakeLock;
    if (!wakeLock) return;
    let sentinel: Sentinel | null = null;
    const acquire = () => {
      if (document.visibilityState === 'visible') {
        wakeLock.request('screen').then(
          (s) => {
            sentinel = s;
          },
          () => undefined,
        );
      }
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release();
    };
  }, []);
}

function useDailyReload(): void {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), msUntilNextReload(new Date()));
    return () => clearTimeout(timer);
  }, []);
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Full-screen kiosk display, meant for Chrome in kiosk mode on the kiosk PC. */
export function KioskScreen({ kioskId }: { kioskId: string }) {
  // undefined: not read yet (the key lives in the browser only).
  const [displayKey, setDisplayKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const { key, stripHash } = resolveDisplayKey(kioskId, window.location.hash, browserStorage());
    if (stripHash)
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setDisplayKey(key);
  }, [kioskId]);

  useScreenWakeLock();
  useDailyReload();
  const now = useNow();
  const live = useKioskState(kioskId, displayKey ?? null);
  const apiDown =
    !live.connected &&
    live.disconnectedSince !== null &&
    now - live.disconnectedSince > API_UNREACHABLE_GRACE_MS;
  const outOfService = apiDown || Boolean(live.state?.outOfService);
  const qr = useQrToken(kioskId, displayKey ?? null, !outOfService);

  if (displayKey === undefined) return <main className="h-dvh bg-slate-950" />;
  if (displayKey === null || live.unauthorized || qr.status === 'unauthorized') {
    return <SetupNeeded kioskId={kioskId} />;
  }

  const state = live.state;
  const qrUrl = qr.status === 'ready' && Date.parse(qr.qr.expiresAt) > now ? qr.qr.url : null;

  return (
    <main
      dir="ltr"
      className="relative flex h-dvh w-full cursor-none select-none overflow-hidden bg-slate-950 text-white portrait:flex-col"
    >
      <section className="flex flex-col items-center justify-center gap-6 p-[3vmin] landscape:w-[50%] portrait:h-[55%]">
        <div className="aspect-square h-[min(68vh,44vw)] rounded-[2rem] bg-white p-[2vmin] shadow-2xl portrait:h-[min(42vh,80vw)]">
          {qrUrl ? (
            <QrCode value={qrUrl} label={KIOSK_COPY.scan.fr} />
          ) : (
            <div className="flex h-full items-center justify-center text-center text-2xl text-slate-500">
              <Tri text={KIOSK_COPY.qrUnavailable} />
            </div>
          )}
        </div>
        <Tri
          text={KIOSK_COPY.scan}
          className="space-y-1 text-center text-[clamp(1.5rem,3vw,3rem)] font-bold"
        />
      </section>

      <section className="flex flex-1 flex-col justify-between gap-8 border-white/10 p-[4vmin] landscape:border-s portrait:border-t">
        <header className="flex items-baseline justify-between">
          <p className="text-3xl font-black tracking-tight text-amber-400">PrintBox</p>
          <p className="text-xl text-slate-400">{state?.name}</p>
        </header>
        <Steps />
        <div className="space-y-4">
          {state?.paperLevel === 'LOW' && (
            <p className="rounded-xl bg-amber-500/20 px-4 py-2 text-lg text-amber-300">
              {KIOSK_COPY.paperLow.fr} ·{' '}
              <span className="font-arabic">{KIOSK_COPY.paperLow.ar}</span>
            </p>
          )}
          <Queue queue={state?.queue ?? []} />
        </div>
      </section>

      {state?.coinPayment && !outOfService && <CoinPayment payment={state.coinPayment} now={now} />}
      {outOfService && (
        <Overlay tone="error">
          <Tri
            text={KIOSK_COPY.outOfService}
            className="space-y-3 text-[clamp(3rem,7vw,7rem)] font-black"
          />
          <Tri
            text={KIOSK_COPY.outOfServiceHelp}
            className="space-y-2 text-[clamp(1.25rem,2.5vw,2.5rem)]"
          />
        </Overlay>
      )}
    </main>
  );
}
