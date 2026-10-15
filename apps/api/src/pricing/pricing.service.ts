import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiErrorCode,
  ColorMode,
  computePriceMillimes,
  PageRangeError,
  parsePageRange,
  PricingRuleValues,
  PrintOptions,
} from '@printbox/shared';
import { ApiException } from '../common/api-exception';
import { AppConfigService } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface Quote {
  /** Normalised selection, null = every page. */
  pageRange: string | null;
  /** Pages that come out of the printer: selected pages × copies. */
  totalPages: number;
  priceMillimes: number;
}

const PAGE_RANGE_MESSAGES: Record<PageRangeError, string> = {
  SYNTAX: 'Pages invalides : utilisez par exemple 1-3,5',
  REVERSED: 'Pages invalides : le début doit précéder la fin (ex. 2-5)',
  OUT_OF_BOUNDS: 'Pages invalides : en dehors du document',
};

@Injectable()
export class PricingService {
  private readonly roundingMillimes: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) env: AppConfigService,
  ) {
    this.roundingMillimes = env.get('PRICE_ROUNDING_MILLIMES', { infer: true });
  }

  /** The kiosk's own rule for this colour mode, else the global one. */
  async ruleFor(kioskId: string, colorMode: ColorMode): Promise<PricingRuleValues> {
    const rules = await this.prisma.pricingRule.findMany({
      where: { colorMode, OR: [{ kioskId }, { kioskId: null }] },
      select: { kioskId: true, pricePerPageMillimes: true, duplexDiscountPercent: true },
    });
    const rule = rules.find((r) => r.kioskId === kioskId) ?? rules.find((r) => r.kioskId === null);
    if (!rule) {
      throw new ApiException(
        503,
        ApiErrorCode.PRICING_UNAVAILABLE,
        'Tarif non configuré pour cette borne',
      );
    }
    return rule;
  }

  async quote(input: {
    kioskId: string;
    pageCount: number;
    options: PrintOptions;
  }): Promise<Quote> {
    const { options } = input;
    const range = parsePageRange(options.pageRange, input.pageCount);
    if (!range.ok) {
      throw new ApiException(
        400,
        ApiErrorCode.INVALID_PAGE_RANGE,
        PAGE_RANGE_MESSAGES[range.error],
      );
    }
    const rule = await this.ruleFor(input.kioskId, options.colorMode);
    return {
      pageRange: range.normalized,
      totalPages: range.pages.length * options.copies,
      priceMillimes: computePriceMillimes({
        selectedPages: range.pages.length,
        copies: options.copies,
        duplex: options.duplex,
        rule,
        roundingMillimes: this.roundingMillimes,
      }),
    };
  }
}
