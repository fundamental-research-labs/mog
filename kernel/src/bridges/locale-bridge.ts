/**
 * Locale Input Bridge
 *
 * Thin bridge glue: resolves SheetId → culture, then delegates to
 * pure functions from @mog/culture for all normalization/detection.
 */

import type { ILocaleBridge, LocaleNormalizationResult } from '@mog-sdk/contracts/bridges';
import type { CellFormat, SheetId } from '@mog-sdk/contracts/core';
import type { CultureInfo } from '@mog-sdk/contracts/culture';

import {
  detectCurrency,
  detectPercentage,
  getCulture,
  getDefaultCulture,
  normalizeNegative,
  normalizeNumber,
  parseFraction,
  stripCurrency,
  stripPercentage,
} from '@mog/culture';

import type { DocumentContext } from '../context/types';

// Re-export for backward compatibility
export type { LocaleNormalizationResult };

export interface LocaleBridgeConfig {
  getCultureName?: (sheetId: SheetId) => string | undefined;
  getWorkbookCultureName?: () => string;
}

export interface LocaleBridge extends ILocaleBridge {}

/**
 * Class-based implementation of LocaleBridge.
 */
export class LocaleInputBridge implements LocaleBridge {
  private config: LocaleBridgeConfig;

  constructor(_ctx: DocumentContext, config: LocaleBridgeConfig = {}) {
    this.config = config;
  }

  private getCultureForSheet(sheetId?: SheetId): CultureInfo {
    if (sheetId && this.config.getCultureName) {
      const sheetCulture = this.config.getCultureName(sheetId);
      if (sheetCulture) {
        const culture = getCulture(sheetCulture);
        if (culture) return culture;
      }
    }

    if (this.config.getWorkbookCultureName) {
      const workbookCulture = this.config.getWorkbookCultureName();
      if (workbookCulture) {
        const culture = getCulture(workbookCulture);
        if (culture) return culture;
      }
    }

    return getDefaultCulture();
  }

  normalizeInput(input: string, sheetId?: SheetId): LocaleNormalizationResult {
    if (!input || typeof input !== 'string') {
      return { normalizedValue: input || '', wasNormalized: false };
    }

    const trimmed = input.trim();
    if (!trimmed) {
      return { normalizedValue: '', wasNormalized: false };
    }

    const culture = this.getCultureForSheet(sheetId);
    let normalizedValue = trimmed;
    let wasNormalized = false;
    let detectedType: LocaleNormalizationResult['detectedType'];
    let suggestedFormat: string | undefined;
    let currencySymbol: string | undefined;

    // Fraction input
    const fractionValue = parseFraction(trimmed);
    if (fractionValue !== null) {
      return {
        normalizedValue: fractionValue.toString(),
        wasNormalized: true,
        detectedType: 'fraction',
        suggestedFormat: '# ?/?',
      };
    }

    // Currency detection
    currencySymbol = detectCurrency(trimmed);
    if (currencySymbol) {
      normalizedValue = stripCurrency(normalizedValue);
      detectedType = 'currency';
      suggestedFormat = `${currencySymbol}#,##0.00`;
      wasNormalized = true;
    }

    // Percentage detection
    if (detectPercentage(normalizedValue)) {
      normalizedValue = stripPercentage(normalizedValue);
      detectedType = 'percentage';
      suggestedFormat = '0%';
      wasNormalized = true;
      const numValue = parseFloat(normalizeNumber(normalizedValue, culture));
      if (!isNaN(numValue)) {
        normalizedValue = (numValue / 100).toString();
      }
    }

    // Negative normalization
    const afterNegative = normalizeNegative(normalizedValue);
    if (afterNegative !== normalizedValue) {
      normalizedValue = afterNegative;
      wasNormalized = true;
    }

    // Number separator normalization
    const afterSeparators = normalizeNumber(normalizedValue, culture);
    if (afterSeparators !== normalizedValue) {
      normalizedValue = afterSeparators;
      wasNormalized = true;
    }

    if (wasNormalized && /^-?\d*\.?\d+$/.test(normalizedValue.replace(/\s/g, ''))) {
      detectedType = detectedType || 'number';
    }

    return {
      normalizedValue,
      wasNormalized,
      detectedType,
      suggestedFormat,
      currencySymbol,
    };
  }

  getDecimalSeparator(sheetId?: SheetId): string {
    return this.getCultureForSheet(sheetId).decimalSeparator;
  }

  getThousandsSeparator(sheetId?: SheetId): string {
    return this.getCultureForSheet(sheetId).thousandsSeparator;
  }

  getCulture(sheetId?: SheetId): CultureInfo {
    return this.getCultureForSheet(sheetId);
  }

  suggestFormat(input: string, sheetId?: SheetId): Partial<CellFormat> | undefined {
    const result = this.normalizeInput(input, sheetId);
    if (!result.suggestedFormat) return undefined;
    return { numberFormat: result.suggestedFormat };
  }

  destroy(): void {}
}

/**
 * Create a mock locale bridge for tests.
 */
export function createMockLocaleBridge(): LocaleBridge {
  const defaultCulture = getDefaultCulture();

  return {
    normalizeInput(input: string): LocaleNormalizationResult {
      return { normalizedValue: input, wasNormalized: false };
    },
    getDecimalSeparator(): string {
      return defaultCulture.decimalSeparator;
    },
    getThousandsSeparator(): string {
      return defaultCulture.thousandsSeparator;
    },
    getCulture(): CultureInfo {
      return defaultCulture;
    },
    suggestFormat(): Partial<CellFormat> | undefined {
      return undefined;
    },
    destroy(): void {},
  };
}
