'use client';

import {
  ColorMode,
  formatMillimes,
  type JobView,
  parsePageRange,
  PRINT_LIMITS,
  type PrintOptions,
} from '@printbox/shared';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { customerApi } from './customer-api';
import { useCustomer, useErrorText } from './customer-context';

/** Typing in the page field or tapping "+" quickly sends one request, not ten. */
const SAVE_DEBOUNCE_MS = 400;

interface Choice<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

function Segmented<T extends string>({
  legend,
  value,
  choices,
  onChange,
  hint,
}: {
  legend: string;
  value: T;
  choices: Choice<T>[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-semibold">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              'flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 px-3 text-center font-semibold has-[input:focus-visible]:ring-4 has-[input:focus-visible]:ring-amber-300',
              choice.value === value
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-900',
              choice.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={choice.value === value}
              disabled={choice.disabled}
              onChange={() => onChange(choice.value)}
            />
            {choice.label}
          </label>
        ))}
      </div>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </fieldset>
  );
}

export function OptionsStep({
  job,
  onSaved,
  onBack,
}: {
  job: JobView;
  onSaved: (job: JobView) => void;
  onBack: () => void;
}) {
  const t = useTranslations('customer.options');
  const errorText = useErrorText();
  const { session, handleError } = useCustomer();
  const { supportsColor, supportsDuplex } = session.kiosk;
  const pageCount = job.file.pageCount ?? 1;
  const fieldId = useId();

  const [options, setOptions] = useState<PrintOptions>({
    copies: job.copies,
    colorMode: job.colorMode,
    duplex: job.duplex,
    pageRange: job.pageRange,
  });
  const [pageText, setPageText] = useState(job.pageRange ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const firstRender = useRef(true);

  const pageCheck = parsePageRange(pageText, pageCount);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setSaving(true);
    const timer = setTimeout(() => {
      customerApi
        .updateOptions(session.sessionToken, job.id, options)
        .then((fresh) => {
          if (cancelled) return;
          onSaved(fresh);
          setError(null);
        })
        .catch((failure: unknown) => {
          if (!cancelled) setError(handleError(failure));
        })
        .finally(() => {
          if (!cancelled) setSaving(false);
        });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Only a change of the chosen options triggers a save.
  }, [options]);

  const update = (patch: Partial<PrintOptions>) =>
    setOptions((current) => ({ ...current, ...patch }));

  const onPagesChange = (text: string) => {
    setPageText(text);
    const parsed = parsePageRange(text, pageCount);
    if (parsed.ok) update({ pageRange: parsed.normalized });
  };

  const checkout = async () => {
    setCheckingOut(true);
    setError(null);
    try {
      onSaved(await customerApi.checkout(session.sessionToken, job.id, 'COIN'));
    } catch (failure) {
      setError(handleError(failure));
      setCheckingOut(false);
    }
  };

  const ready =
    !saving && !checkingOut && pageCheck.ok && error === null && job.priceMillimes !== null;

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
        </Button>
        <CardTitle>{t('title')}</CardTitle>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span id={`${fieldId}-copies`} className="font-semibold">
          {t('copies')}
        </span>
        <div className="flex items-center gap-3" role="group" aria-labelledby={`${fieldId}-copies`}>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('fewer')}
            disabled={options.copies <= PRINT_LIMITS.minCopies}
            onClick={() => update({ copies: options.copies - 1 })}
          >
            <Minus aria-hidden className="size-5" />
          </Button>
          <output aria-live="polite" className="w-8 text-center text-2xl font-bold tabular-nums">
            {options.copies}
          </output>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('more')}
            disabled={options.copies >= PRINT_LIMITS.maxCopies}
            onClick={() => update({ copies: options.copies + 1 })}
          >
            <Plus aria-hidden className="size-5" />
          </Button>
        </div>
      </div>

      <Segmented
        legend={t('colorMode')}
        value={options.colorMode}
        onChange={(colorMode) => update({ colorMode })}
        choices={[
          { value: ColorMode.BW, label: t('bw') },
          { value: ColorMode.COLOR, label: t('color'), disabled: !supportsColor },
        ]}
        hint={supportsColor ? undefined : `${t('color')} : ${t('unavailable')}`}
      />

      <Segmented
        legend={t('sides')}
        value={options.duplex ? 'duplex' : 'simplex'}
        onChange={(value) => update({ duplex: value === 'duplex' })}
        choices={[
          { value: 'simplex', label: t('simplex') },
          { value: 'duplex', label: t('duplex'), disabled: !supportsDuplex },
        ]}
        hint={supportsDuplex ? undefined : `${t('duplex')} : ${t('unavailable')}`}
      />

      {pageCount > 1 && (
        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="font-semibold">
            {t('pages')}
          </label>
          <input
            id={fieldId}
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            value={pageText}
            onChange={(event) => onPagesChange(event.target.value)}
            placeholder={`1-${pageCount}`}
            aria-invalid={!pageCheck.ok}
            aria-describedby={`${fieldId}-hint`}
            className={cn(
              'min-h-12 rounded-xl border-2 px-4 text-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 rtl:text-right',
              pageCheck.ok ? 'border-slate-300' : 'border-red-500',
            )}
          />
          <p
            id={`${fieldId}-hint`}
            className={cn('text-sm', pageCheck.ok ? 'text-slate-500' : 'text-red-700')}
          >
            {pageCheck.ok ? t('pagesHint') : errorText('INVALID_PAGE_RANGE')}
          </p>
        </div>
      )}

      <div
        className="flex items-end justify-between rounded-2xl bg-slate-100 p-4"
        aria-live="polite"
      >
        <div>
          <p className="font-semibold">{t('total')}</p>
          {job.totalPages !== null && (
            <p className="text-sm text-slate-600">{t('printedPages', { count: job.totalPages })}</p>
          )}
        </div>
        <p
          className={cn(
            'text-3xl font-bold tabular-nums',
            (saving || !pageCheck.ok) && 'opacity-40',
          )}
          dir="ltr"
        >
          {job.priceMillimes === null ? '—' : formatMillimes(job.priceMillimes)}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">
          {errorText(error)}
        </p>
      )}

      <Button size="lg" variant="accent" block disabled={!ready} onClick={() => void checkout()}>
        {job.priceMillimes === null || saving
          ? t('updating')
          : t('validate', { price: formatMillimes(job.priceMillimes) })}
      </Button>
    </Card>
  );
}
