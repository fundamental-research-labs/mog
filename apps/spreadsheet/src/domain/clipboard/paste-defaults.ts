import { getEnvVar, isDev, isTest } from '@mog/env';
import type { PasteSpecialOptions } from '@mog-sdk/contracts/actors';

import {
  LEGACY_PASTE_DEFAULTS_V1,
  sanitizePasteDefaultsPreference,
  type PasteDefaultsPreferenceV1,
} from '../../infra/state/paste-defaults-store';
import { parseHTML } from '../../infra/utils/clipboard-utils';
import { createDefaultPasteOptions } from './paste-executor';

export type PasteSourceKind =
  | 'internal-copy'
  | 'internal-cut'
  | 'external-text'
  | 'external-html'
  | 'external-image';

export interface PasteDefaultContext {
  sourceKind: PasteSourceKind;
  hasInternalRichData?: boolean;
  hasExternalHtml?: boolean;
  hasExternalText?: boolean;
}

export interface ResolvedPasteDefaults {
  options: PasteSpecialOptions;
  appliesDefault: boolean;
  reason:
    | 'normal-default'
    | 'cut-move-preserved'
    | 'image-paste-unaffected'
    | 'feature-disabled-fallback'
    | 'unsupported-source-fallback'
    | 'invalid-preference-fallback';
}

export const ENABLE_PASTE_DEFAULTS_V1 = getEnvVar('VITE_ENABLE_PASTE_DEFAULTS_V1') !== 'false';

function devDiagnostic(message: string, details?: unknown): void {
  if (!isDev() && !isTest()) return;
  // eslint-disable-next-line no-console
  console.debug(`[paste-defaults] ${message}`, details ?? '');
}

function isValidPreference(value: unknown): value is PasteDefaultsPreferenceV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PasteDefaultsPreferenceV1>;
  return (
    candidate.version === 1 &&
    (candidate.defaultPasteType === 'all' ||
      candidate.defaultPasteType === 'values' ||
      candidate.defaultPasteType === 'formulas' ||
      candidate.defaultPasteType === 'formats') &&
    typeof candidate.skipBlanks === 'boolean' &&
    typeof candidate.transpose === 'boolean'
  );
}

function isImpossibleContext(context: PasteDefaultContext): boolean {
  switch (context.sourceKind) {
    case 'internal-copy':
    case 'internal-cut':
      return context.hasExternalHtml === true || context.hasExternalText === true;
    case 'external-text':
      return context.hasInternalRichData === true || context.hasExternalHtml === true;
    case 'external-html':
      return context.hasInternalRichData === true || context.hasExternalHtml === false;
    case 'external-image':
      return (
        context.hasInternalRichData === true ||
        context.hasExternalHtml === true ||
        context.hasExternalText === true
      );
  }
}

function mapPreferenceToOptions(preference: PasteDefaultsPreferenceV1): PasteSpecialOptions {
  const options = createDefaultPasteOptions();
  options.skipBlanks = preference.skipBlanks;
  options.transpose = preference.transpose;

  switch (preference.defaultPasteType) {
    case 'values':
      options.values = true;
      break;
    case 'formulas':
      options.formulas = true;
      break;
    case 'formats':
      options.formats = true;
      break;
    case 'all':
      break;
  }

  return options;
}

export function resolveDefaultPasteOptions(
  preference: unknown,
  context: PasteDefaultContext,
): ResolvedPasteDefaults {
  const legacyOptions = createDefaultPasteOptions();

  if (!ENABLE_PASTE_DEFAULTS_V1) {
    return {
      options: legacyOptions,
      appliesDefault: false,
      reason: 'feature-disabled-fallback',
    };
  }

  if (isImpossibleContext(context)) {
    devDiagnostic('unsupported source fallback', context);
    return {
      options: legacyOptions,
      appliesDefault: false,
      reason: 'unsupported-source-fallback',
    };
  }

  if (context.sourceKind === 'internal-cut') {
    return {
      options: legacyOptions,
      appliesDefault: false,
      reason: 'cut-move-preserved',
    };
  }

  if (context.sourceKind === 'external-image') {
    return {
      options: legacyOptions,
      appliesDefault: false,
      reason: 'image-paste-unaffected',
    };
  }

  if (!isValidPreference(preference)) {
    devDiagnostic('invalid preference fallback', preference);
    return {
      options: legacyOptions,
      appliesDefault: false,
      reason: 'invalid-preference-fallback',
    };
  }

  const sanitized = sanitizePasteDefaultsPreference(preference);
  const options = mapPreferenceToOptions(sanitized);
  devDiagnostic('resolved normal paste default', { context, preference: sanitized, options });

  return {
    options,
    appliesDefault: true,
    reason: 'normal-default',
  };
}

export function getPasteDefaultLabel(
  preference: PasteDefaultsPreferenceV1 = LEGACY_PASTE_DEFAULTS_V1,
): string {
  const typeLabel =
    preference.defaultPasteType === 'all'
      ? 'All'
      : preference.defaultPasteType === 'values'
        ? 'Values'
        : preference.defaultPasteType === 'formulas'
          ? 'Formulas'
          : 'Formats';
  const suffixes = [
    preference.skipBlanks ? 'Skip blanks' : null,
    preference.transpose ? 'Transpose' : null,
  ].filter(Boolean);
  return `Default: ${[typeLabel, ...suffixes].join(', ')}`;
}

export function hasUsableExternalFormatPayload(html?: string): boolean {
  if (!html) return false;
  const parsed = parseHTML(html);
  return Boolean(
    parsed?.formats.some((row) => row.some((format) => format && Object.keys(format).length > 0)),
  );
}

export function shouldNoopExternalFormatsPaste(
  options: PasteSpecialOptions | undefined,
  html?: string,
): boolean {
  if (!options?.formats || options.values || options.formulas || options.pasteLink) return false;
  return !hasUsableExternalFormatPayload(html);
}
