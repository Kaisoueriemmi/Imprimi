/**
 * Kiosk screen texts. The kiosk shows all three languages at once (no language switch on a
 * shared screen): French, Arabic (right-to-left) and English.
 */
export const KIOSK_COPY = {
  scan: {
    fr: 'Scannez pour imprimer',
    ar: 'امسح الرمز للطباعة',
    en: 'Scan to print',
  },
  steps: {
    fr: [
      'Scannez le QR code avec votre téléphone',
      'Envoyez votre document : PDF, photo ou Word',
      'Payez ici en pièces, la machine rend la monnaie',
      'Récupérez vos feuilles',
    ],
    ar: [
      'امسح رمز QR بهاتفك',
      'أرسل مستندك: PDF أو صورة أو Word',
      'ادفع هنا بالقطع النقدية، والآلة تُرجع الباقي',
      'خذ أوراقك',
    ],
    en: [
      'Scan the QR code with your phone',
      'Send your document: PDF, photo or Word',
      'Pay here with coins, change is given',
      'Collect your pages',
    ],
  },
  queueTitle: { fr: "File d'impression", ar: 'قائمة الطباعة', en: 'Print queue' },
  queueEmpty: {
    fr: 'Aucune impression en attente',
    ar: 'لا توجد طباعة في الانتظار',
    en: 'Nothing waiting',
  },
  jobStatus: {
    PAID: { fr: 'Payé', ar: 'مدفوع', en: 'Paid' },
    QUEUED: { fr: 'En attente', ar: 'في الانتظار', en: 'Waiting' },
    PRINTING: { fr: 'Impression en cours', ar: 'جارٍ الطبع', en: 'Printing' },
  },
  insertCoins: { fr: 'Insérez vos pièces', ar: 'أدخل القطع النقدية', en: 'Insert coins' },
  remaining: { fr: 'Reste à payer', ar: 'المبلغ المتبقي', en: 'Left to pay' },
  received: { fr: 'Reçu', ar: 'المبلغ المستلم', en: 'Received' },
  changeGiven: {
    fr: 'La machine rend la monnaie',
    ar: 'الآلة تُرجع الباقي',
    en: 'Change is given',
  },
  outOfService: { fr: 'Hors service', ar: 'خارج الخدمة', en: 'Out of service' },
  outOfServiceHelp: {
    fr: 'Merci de vous adresser au comptoir.',
    ar: 'يرجى التوجه إلى الشبّاك.',
    en: 'Please ask at the counter.',
  },
  paperLow: { fr: 'Papier bientôt épuisé', ar: 'الورق على وشك النفاد', en: 'Paper running low' },
  qrUnavailable: {
    fr: 'QR momentanément indisponible',
    ar: 'رمز QR غير متاح مؤقتًا',
    en: 'QR temporarily unavailable',
  },
} as const;

export type Trilingual = { fr: string; ar: string; en: string };
