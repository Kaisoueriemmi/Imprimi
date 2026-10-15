'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** Crisp SVG QR code at any screen size (rendered as an image from a data URL). */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(value, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then((svg) => {
      if (!cancelled) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!src) return <div className="h-full w-full animate-pulse rounded-2xl bg-slate-100" />;
  return <img src={src} alt={label} className="h-full w-full" draggable={false} />;
}
