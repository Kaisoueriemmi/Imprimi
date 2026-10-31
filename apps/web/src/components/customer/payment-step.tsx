'use client';

import { type CoinSessionView, formatMillimes, type JobView } from '@printbox/shared';
import { Coins, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNow } from '@/components/kiosk/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { customerApi } from './customer-api';
import { errorCodeOf, formatPickupCode, useCustomer, useErrorText } from './customer-context';

export function PaymentStep({
  job,
  onChanged,
}: {
  job: JobView;
  onChanged: (job: JobView) => void;
}) {
  const t = useTranslations('customer.payment');
  const errorText = useErrorText();
  const { session, handleError } = useCustomer();
  const token = session.sessionToken;
  const now = useNow();
  const [coins, setCoinsState] = useState<CoinSessionView | null>(null);
  const coinsRef = useRef<CoinSessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setCoins = (next: CoinSessionView | null) => {
    coinsRef.current = next;
    setCoinsState(next);
  };

  /** Re-reads the reservation (new deadline after each coin); it is gone once it lapsed. */
  const refreshCoins = useCallback(() => {
    customerApi
      .getCoins(token, job.id)
      .then((view) => {
        coinsRef.current = view;
        setCoinsState(view);
      })
      .catch((failure: unknown) => {
        if (errorCodeOf(failure) !== 'NOT_FOUND') return;
        const previous = coinsRef.current;
        coinsRef.current = null;
        setCoinsState(null);
        // Coins inserted before the reservation lapsed are given back by the machine.
        if (previous && previous.receivedMillimes > 0) setNotice(t('cancelled'));
      });
  }, [token, job.id, t]);

  // A reload in the middle of a coin payment finds its reservation back; each coin moves the deadline.
  const received = job.payment?.receivedMillimes ?? 0;
  useEffect(() => refreshCoins(), [received, refreshCoins]);

  const secondsLeft = coins
    ? Math.max(0, Math.ceil((Date.parse(coins.expiresAt) - now) / 1000))
    : 0;
  const lapsed = coins !== null && secondsLeft === 0;
  useEffect(() => {
    if (lapsed) refreshCoins();
  }, [lapsed, refreshCoins]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setError(handleError(failure));
    } finally {
      setBusy(false);
    }
  };

  const amount = job.priceMillimes ?? 0;
  const paid = Math.max(received, coins?.receivedMillimes ?? 0);
  const remaining = Math.max(0, amount - paid);

  const startCoins = () => run(async () => setCoins(await customerApi.startCoins(token, job.id)));
  const cancelCoins = () =>
    run(async () => {
      await customerApi.cancelCoins(token, job.id);
      setCoins(null);
      if (paid > 0) setNotice(t('cancelled'));
    });
  const cancelJob = () => {
    if (!window.confirm(t('cancelConfirm'))) return;
    void run(async () => onChanged(await customerApi.cancelJob(token, job.id)));
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-2 text-center">
        <CardTitle>{t('title')}</CardTitle>
        {job.pickupCode && (
          <p dir="ltr" className="font-mono text-5xl font-bold tracking-widest tabular-nums">
            {formatPickupCode(job.pickupCode)}
          </p>
        )}
        <p className="text-sm text-slate-600">{t('codeHelp')}</p>
        <p className="mt-2 text-lg">
          {t('amount')}{' '}
          <strong dir="ltr" className="text-2xl tabular-nums">
            {formatMillimes(amount)}
          </strong>
        </p>
      </Card>

      {coins ? (
        <Card className="flex flex-col gap-3 border-amber-300 bg-amber-50">
          <div className="flex items-center gap-3">
            <Coins aria-hidden className="size-8 shrink-0 text-amber-600" />
            <p className="text-lg font-bold">{t('insert')}</p>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={amount}
            aria-valuenow={paid}
            aria-valuetext={t('received', { amount: formatMillimes(paid) })}
            className="h-4 overflow-hidden rounded-full bg-white"
          >
            <div
              className="h-full bg-amber-400 transition-[width]"
              style={{ width: `${amount > 0 ? Math.min(100, (paid / amount) * 100) : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-sm">
            <span>{t('received', { amount: formatMillimes(paid) })}</span>
            <span className="tabular-nums" aria-hidden>
              {t('timeLeft', { seconds: secondsLeft })}
            </span>
          </div>
          <p aria-live="polite" className="text-xl font-bold">
            {t('remaining', { amount: formatMillimes(remaining) })}
          </p>
          <p className="text-sm text-slate-600">{t('change')}</p>
          <Button variant="outline" block disabled={busy} onClick={() => void cancelCoins()}>
            {t('cancelCoins')}
          </Button>
        </Card>
      ) : (
        <Button size="lg" variant="accent" block disabled={busy} onClick={() => void startCoins()}>
          <Coins aria-hidden className="size-5" />
          {t('payCoins')}
        </Button>
      )}

      {notice && (
        <p role="status" className="rounded-xl bg-sky-50 p-3 text-sm font-medium text-sky-900">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">
          {errorText(error)}
        </p>
      )}

      <Card className="flex gap-3">
        <Store aria-hidden className="size-6 shrink-0 text-slate-500" />
        <div>
          <h3 className="font-semibold">{t('payCounter')}</h3>
          <p className="text-sm text-slate-600">{t('counterHelp')}</p>
        </div>
      </Card>

      <Button variant="danger" block disabled={busy} onClick={cancelJob}>
        {t('cancelJob')}
      </Button>
    </div>
  );
}
