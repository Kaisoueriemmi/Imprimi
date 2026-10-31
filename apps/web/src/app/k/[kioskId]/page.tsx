import type { Metadata } from 'next';
import { CustomerApp } from '@/components/customer/customer-app';

export const metadata: Metadata = {
  title: 'PrintBox',
  robots: { index: false, follow: false },
  // The QR token is in the first URL: never hand it to another site.
  referrer: 'no-referrer',
};

export default async function CustomerPage({ params }: { params: Promise<{ kioskId: string }> }) {
  const { kioskId } = await params;
  return <CustomerApp kioskId={decodeURIComponent(kioskId)} />;
}
