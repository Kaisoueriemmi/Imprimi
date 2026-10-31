'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALE_COOKIE, LOCALES, type Locale } from '@/i18n/locales';
import { cn } from '@/lib/utils';

/** Each language is named in itself, so a customer always finds theirs. */
const NAMES: Record<Locale, string> = { fr: 'Français', ar: 'العربية', en: 'English' };

/** Stores the choice in a cookie and re-renders the server parts (texts, `dir`) in place. */
export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations('customer');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <nav aria-label={t('language')}>
      <ul className="flex gap-1">
        {LOCALES.map((option) => (
          <li key={option}>
            <button
              type="button"
              lang={option}
              aria-current={option === locale ? 'true' : undefined}
              disabled={pending}
              onClick={() => choose(option)}
              className={cn(
                'min-h-11 rounded-lg px-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300',
                option === 'ar' && 'font-arabic',
                option === locale ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-slate-800',
              )}
            >
              {NAMES[option]}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
