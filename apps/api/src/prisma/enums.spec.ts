import { $Enums } from '@prisma/client';
import * as shared from '@printbox/shared';
import { describe, expect, it } from 'vitest';

// The shared package is the contract used by web and agent; the database must agree with it.
describe('Prisma enums match @printbox/shared', () => {
  it.each([
    ['KioskStatus', $Enums.KioskStatus, shared.KioskStatus],
    ['PaperLevel', $Enums.PaperLevel, shared.PaperLevel],
    ['ColorMode', $Enums.ColorMode, shared.ColorMode],
    ['JobStatus', $Enums.JobStatus, shared.JobStatus],
    ['ConversionStatus', $Enums.ConversionStatus, shared.ConversionStatus],
    ['PaymentProvider', $Enums.PaymentProvider, shared.PaymentProvider],
    ['CoinEventKind', $Enums.CoinEventKind, shared.CoinEventKind],
    ['PaymentStatus', $Enums.PaymentStatus, shared.PaymentStatus],
    ['AdminRole', $Enums.AdminRole, shared.AdminRole],
  ])('%s', (_name, prismaEnum, sharedEnum) => {
    expect({ ...prismaEnum }).toEqual({ ...sharedEnum });
  });
});
