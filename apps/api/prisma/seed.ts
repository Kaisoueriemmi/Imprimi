/* eslint-disable no-console -- CLI script: printing the generated credentials is its purpose. */
import { AdminRole, ColorMode, PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { generateApiKey, hashApiKey } from '../src/common/api-key';
import { hashPassword } from '../src/common/password';

/**
 * Idempotent seed: 1 demo kiosk, 1 OWNER admin, global pricing rules.
 * Secrets come from SEED_* env vars, or are generated and printed once.
 * Existing kiosk keys and admin passwords are never rotated by a re-run.
 */

const DEMO_KIOSK_ID = 'demo-kiosk';

/** Placeholder prices, editable from the admin dashboard (Phase 7). */
const GLOBAL_PRICING = [
  { colorMode: ColorMode.BW, pricePerPageMillimes: 100, duplexDiscountPercent: 10 },
  { colorMode: ColorMode.COLOR, pricePerPageMillimes: 500, duplexDiscountPercent: 10 },
] as const;

const prisma = new PrismaClient();

async function seedKiosk(): Promise<void> {
  const existing = await prisma.kiosk.findUnique({ where: { id: DEMO_KIOSK_ID } });
  if (existing) {
    console.log(`Kiosk "${DEMO_KIOSK_ID}" already exists, keys unchanged.`);
    return;
  }
  const apiKey = process.env.SEED_KIOSK_API_KEY ?? generateApiKey('pbk');
  const displayKey = process.env.SEED_KIOSK_DISPLAY_KEY ?? generateApiKey('pbd');
  await prisma.kiosk.create({
    data: {
      id: DEMO_KIOSK_ID,
      name: 'Borne démo',
      location: 'Boutique',
      apiKeyHash: hashApiKey(apiKey),
      displayKeyHash: hashApiKey(displayKey),
      printerName: process.env.SEED_KIOSK_PRINTER_NAME ?? null,
      supportsColor: true,
      supportsDuplex: true,
    },
  });
  console.log(`Kiosk "${DEMO_KIOSK_ID}" created. Store these keys now, they are not shown again:`);
  console.log(`  KIOSK_API_KEY (agent)        = ${apiKey}`);
  console.log(`  KIOSK_DISPLAY_KEY (écran)    = ${displayKey}`);
}

async function seedAdmin(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@printbox.local').toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists, password unchanged.`);
    return;
  }
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  await prisma.adminUser.create({
    data: { email, passwordHash: await hashPassword(password), role: AdminRole.OWNER },
  });
  console.log(`Admin ${email} created (OWNER).`);
  if (!process.env.SEED_ADMIN_PASSWORD) console.log(`  generated password = ${password}`);
}

async function seedPricing(): Promise<void> {
  for (const rule of GLOBAL_PRICING) {
    // A compound unique with a NULL member cannot be used in upsert(): find, then create.
    const existing = await prisma.pricingRule.findFirst({
      where: { kioskId: null, colorMode: rule.colorMode },
    });
    if (!existing) await prisma.pricingRule.create({ data: { kioskId: null, ...rule } });
  }
  console.log('Global pricing rules present.');
}

async function main(): Promise<void> {
  await seedKiosk();
  await seedAdmin();
  await seedPricing();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
