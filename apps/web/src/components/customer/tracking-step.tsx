'use client';

import { formatMillimes, type JobView } from '@printbox/shared';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatPickupCode } from './customer-context';

const PROGRESS = ['PAID', 'QUEUED', 'PRINTING', 'PRINTED'] as const;
type ProgressStatus = (typeof PROGRESS)[number];
const isProgress = (status: string): status is ProgressStatus =>
  PROGRESS.includes(status as ProgressStatus);

export function TrackingStep({
  job,
  connected,
  onAnother,
}: {
  job: JobView;
  connected: boolean;
  onAnother: () => void;
}) {
  const t = useTranslations('customer.tracking');
  const printed = job.status === 'PRINTED';
  const inProgress = isProgress(job.status) && !printed;
  const failed = !isProgress(job.status);
  const current = isProgress(job.status) ? PROGRESS.indexOf(job.status) : -1;
  const change = job.payment?.changeDueMillimes ?? 0;

  return (
    <Card className="flex flex-col items-center gap-5 text-center">
      {printed && <CheckCircle2 aria-hidden className="size-20 text-emerald-600" />}
      {inProgress && (
        <Loader2
          aria-hidden
          className="size-20 animate-spin text-amber-500 motion-reduce:animate-none"
        />
      )}
      {failed && <XCircle aria-hidden className="size-20 text-red-600" />}

      <p
        role="status"
        aria-live="polite"
        className={cn('text-2xl font-bold', printed && 'text-emerald-700')}
      >
        {t.has(job.status) ? t(job.status) : t('FAILED')}
      </p>

      {!failed && (
        <ol className="flex w-full flex-col gap-2 text-start">
          {PROGRESS.map((status, index) => (
            <li key={status} className="flex items-center gap-3">
              {index <= current ? (
                <CheckCircle2 aria-hidden className="size-5 shrink-0 text-emerald-600" />
              ) : (
                <Circle aria-hidden className="size-5 shrink-0 text-slate-300" />
              )}
              <span className={index <= current ? 'font-medium' : 'text-slate-500'}>
                {status === 'PRINTED' ? t('done') : t(status)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {job.pickupCode && (
        <p className="font-medium text-slate-700">
          {t('code', { code: formatPickupCode(job.pickupCode) })}
        </p>
      )}
      {change > 0 && (
        <p className="rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
          {t('change', { amount: formatMillimes(change) })}
        </p>
      )}
      {!connected && inProgress && <p className="text-sm text-slate-500">{t('offline')}</p>}

      {!inProgress && (
        <Button size="lg" block onClick={onAnother}>
          {t('another')}
        </Button>
      )}
    </Card>
  );
}
