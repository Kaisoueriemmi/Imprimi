'use client';

import { type JobView, UPLOAD_LIMITS } from '@printbox/shared';
import { Camera, FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, type DragEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ApiRequestError, customerApi } from './customer-api';
import { useCustomer, useErrorText } from './customer-context';
import { shrinkPhoto } from './photo';

const ACCEPT = ['.pdf', '.jpg', '.jpeg', '.png', '.docx', ...UPLOAD_LIMITS.allowedMimeTypes].join(
  ',',
);

export function UploadStep({ onUploaded }: { onUploaded: (job: JobView) => void }) {
  const t = useTranslations('customer.upload');
  const errorText = useErrorText();
  const { session, handleError } = useCustomer();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploading = progress !== null;

  const send = async (file: File): Promise<void> => {
    setError(null);
    setProgress(0);
    try {
      const ready = await shrinkPhoto(file);
      if (ready.size > UPLOAD_LIMITS.maxFileBytes) throw new ApiRequestError('FILE_TOO_LARGE', 413);
      onUploaded(await customerApi.uploadFile(session.sessionToken, ready, setProgress));
    } catch (failure) {
      setProgress(null);
      setError(handleError(failure));
    }
  };

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // the same file can be picked again after an error
    if (file) void send(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !uploading) void send(file);
  };

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <CardTitle>{t('title')}</CardTitle>
        <p className="mt-1 text-sm text-slate-600">{t('formats')}</p>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col gap-3 rounded-2xl border-2 border-dashed p-4 transition-colors',
          dragging ? 'border-amber-400 bg-amber-50' : 'border-slate-300',
        )}
      >
        <Button size="lg" block disabled={uploading} onClick={() => fileInput.current?.click()}>
          <FileUp aria-hidden className="size-5" />
          {t('pick')}
        </Button>
        <Button
          size="lg"
          variant="outline"
          block
          disabled={uploading}
          onClick={() => cameraInput.current?.click()}
        >
          <Camera aria-hidden className="size-5" />
          {t('camera')}
        </Button>
        <p className="hidden text-center text-sm text-slate-500 [@media(pointer:fine)]:block">
          {t('drop')}
        </p>
      </div>

      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={onPicked} />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onPicked}
      />

      {uploading && (
        <div className="flex flex-col gap-2">
          <p aria-live="polite" className="text-sm font-medium">
            {progress < 100 ? t('uploading', { percent: progress }) : t('preparing')}
          </p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-3 overflow-hidden rounded-full bg-slate-200"
          >
            <div
              className="h-full bg-amber-400 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">
          {errorText(error)}
        </p>
      )}
    </Card>
  );
}
