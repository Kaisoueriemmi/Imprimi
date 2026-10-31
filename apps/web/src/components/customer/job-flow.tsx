'use client';

import { ConversionStatus, JobStatus, type JobView } from '@printbox/shared';
import { FileText, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { customerApi } from './customer-api';
import { useCustomer, useErrorText } from './customer-context';
import { OptionsStep } from './options-step';
import { PaymentStep } from './payment-step';
import { TrackingStep } from './tracking-step';
import { isConverting, useLiveJob } from './use-live-job';

function Thumbnail({ job }: { job: JobView }) {
  const t = useTranslations('customer.preview');
  const { session } = useCustomer();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!job.hasThumbnail) return;
    let cancelled = false;
    let created: string | null = null;
    customerApi
      .thumbnailUrl(session.sessionToken, job.id)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        created = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => {
        // The placeholder stays.
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [session.sessionToken, job.id, job.hasThumbnail]);

  return (
    <div className="mx-auto flex aspect-[210/297] w-48 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-inner">
      {url ? (
        // A blob URL: nothing for next/image to optimise.
        <img src={url} alt={t('alt')} className="h-full w-full object-contain" />
      ) : (
        <span className="flex flex-col items-center gap-2 p-4 text-center text-sm text-slate-500">
          <FileText aria-hidden className="size-10" />
          {job.hasThumbnail ? null : t('noThumbnail')}
        </span>
      )}
    </div>
  );
}

function PreviewStep({
  job,
  onContinue,
  onChange,
}: {
  job: JobView;
  onContinue: () => void;
  onChange: () => void;
}) {
  const t = useTranslations('customer.preview');
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>{t('title')}</CardTitle>
      <Thumbnail job={job} />
      {job.file.pageCount !== null && (
        <p className="text-center font-medium">{t('pages', { count: job.file.pageCount })}</p>
      )}
      <Button size="lg" block onClick={onContinue}>
        {t('continue')}
      </Button>
      <Button variant="ghost" block onClick={onChange}>
        {t('change')}
      </Button>
    </Card>
  );
}

/** Everything after the upload: preview → options → code and payment → live tracking. */
export function JobFlow({ initial, onRestart }: { initial: JobView; onRestart: () => void }) {
  const tUpload = useTranslations('customer.upload');
  const tPreview = useTranslations('customer.preview');
  const errorText = useErrorText();
  const { session, handleError } = useCustomer();
  const { job, setJob, connected } = useLiveJob(session.sessionToken, initial);
  const [step, setStep] = useState<'preview' | 'options'>('preview');

  /** Another document: the unpaid one is cancelled so its file is deleted at once. */
  const replace = () => {
    customerApi
      .cancelJob(session.sessionToken, job.id)
      .catch((failure: unknown) => handleError(failure));
    onRestart();
  };

  if (isConverting(job)) {
    return (
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <Loader2
          aria-hidden
          className="size-12 animate-spin text-amber-500 motion-reduce:animate-none"
        />
        <p role="status" className="text-lg font-semibold">
          {tUpload('preparing')}
        </p>
      </Card>
    );
  }

  if (job.conversionStatus === ConversionStatus.FAILED) {
    return (
      <Card className="flex flex-col gap-4">
        <p role="alert" className="rounded-xl bg-red-50 p-3 font-medium text-red-800">
          {errorText(job.errorMessage ?? 'CONVERSION_FAILED')}
        </p>
        <Button size="lg" block onClick={onRestart}>
          {tPreview('change')}
        </Button>
      </Card>
    );
  }

  if (job.status === JobStatus.UPLOADED) {
    return step === 'preview' ? (
      <PreviewStep job={job} onContinue={() => setStep('options')} onChange={replace} />
    ) : (
      <OptionsStep job={job} onSaved={setJob} onBack={() => setStep('preview')} />
    );
  }

  if (job.status === JobStatus.AWAITING_PAYMENT)
    return <PaymentStep job={job} onChanged={setJob} />;

  return <TrackingStep job={job} connected={connected} onAnother={onRestart} />;
}
