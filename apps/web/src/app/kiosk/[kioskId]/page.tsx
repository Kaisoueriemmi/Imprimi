import type { Metadata } from 'next';
import { KioskScreen } from '@/components/kiosk/kiosk-screen';

export const metadata: Metadata = {
  title: 'PrintBox — borne',
  robots: { index: false, follow: false },
};

export default async function KioskPage({ params }: { params: Promise<{ kioskId: string }> }) {
  const { kioskId } = await params;
  return <KioskScreen kioskId={decodeURIComponent(kioskId)} />;
}
