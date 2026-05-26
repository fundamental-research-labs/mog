/**
 * Number Format Locale Utilities
 *
 * Handles LCID (Locale ID) tokens embedded in Excel number format strings.
 * XLSX uses `[$-LCID]` prefixes to encode locale information within format codes.
 *
 * For example:
 * - `[$-409]#,##0.00` → en-US number format
 * - `[$-407]#.##0,00` → de-DE number format (comma decimal, period thousands)
 *
 * These utilities support:
 * - Extracting LCID tokens from format strings
 * - Resolving locale-aware format strings (GET path)
 * - Encoding locale-specific formats with LCID prefixes (SET path)
 */

// =============================================================================
// LCID Mapping Table — Top 10 locales
// =============================================================================

export interface LocaleInfo {
  /** BCP-47 locale tag (e.g., "en-US") */
  locale: string;
  /** Decimal separator for the locale */
  decimalSep: string;
  /** Thousands separator for the locale */
  thousandsSep: string;
}

/**
 * Map from hex LCID (lowercase, no leading zeros) to locale info.
 * Covers the top 10 locales by usage.
 */
const LCID_TO_LOCALE: Record<string, LocaleInfo> = {
  '409': { locale: 'en-US', decimalSep: '.', thousandsSep: ',' },
  '809': { locale: 'en-GB', decimalSep: '.', thousandsSep: ',' },
  '407': { locale: 'de-DE', decimalSep: ',', thousandsSep: '.' },
  '40c': { locale: 'fr-FR', decimalSep: ',', thousandsSep: '\u00A0' }, // non-breaking space
  '410': { locale: 'it-IT', decimalSep: ',', thousandsSep: '.' },
  c0a: { locale: 'es-ES', decimalSep: ',', thousandsSep: '.' },
  '416': { locale: 'pt-BR', decimalSep: ',', thousandsSep: '.' },
  '411': { locale: 'ja-JP', decimalSep: '.', thousandsSep: ',' },
  '412': { locale: 'ko-KR', decimalSep: '.', thousandsSep: ',' },
  '804': { locale: 'zh-CN', decimalSep: '.', thousandsSep: ',' },
};

/**
 * Reverse map: BCP-47 locale tag (lowercase) → hex LCID string.
 */
const LOCALE_TO_LCID: Record<string, string> = {};
for (const [lcid, info] of Object.entries(LCID_TO_LOCALE)) {
  LOCALE_TO_LCID[info.locale.toLowerCase()] = lcid;
}

// en-US is also the default / fallback locale
const EN_US_INFO: LocaleInfo = LCID_TO_LOCALE['409'];

// =============================================================================
// Regex for [$-LCID] tokens
// =============================================================================

/**
 * Matches a `[$-XXXX]` locale token at the start of a format string.
 * Captures the hex LCID value (group 1). Case-insensitive.
 *
 * Examples:
 *   "[$-409]#,##0.00"  → match, group 1 = "409"
 *   "[$-0407]#.##0,00" → match, group 1 = "0407"
 */
const LCID_PREFIX_RE = /^\[\$-([0-9A-Fa-f]+)\]/;

/**
 * Matches all `[$-XXXX]` tokens anywhere in the string (for stripping).
 */
const LCID_GLOBAL_RE = /\[\$-[0-9A-Fa-f]+\]/g;

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract the LCID hex string from a number format code.
 *
 * @param numberFormat - The raw number format string (e.g., "[$-409]#,##0.00")
 * @returns The hex LCID string (e.g., "409"), or undefined if no locale token is present
 */
export function extractLCID(numberFormat: string): string | undefined {
  const match = numberFormat.match(LCID_PREFIX_RE);
  return match ? match[1] : undefined;
}

/**
 * Normalize an LCID hex string by stripping leading zeros and lowering case.
 * E.g., "0409" → "409", "040C" → "40c"
 */
function normalizeLCID(lcid: string): string {
  return lcid.replace(/^0+/, '').toLowerCase() || '0';
}

/**
 * Get the locale-aware number format by resolving the LCID token.
 *
 * For known LCIDs, transforms separators to match the target locale's conventions.
 * For unknown LCIDs or formats with no LCID token, strips the token and returns the raw format.
 *
 * @param numberFormat - The raw format string (possibly with [$-LCID] prefix)
 * @returns The locale-resolved format string (without [$-LCID] tokens)
 */
export function getNumberFormatLocal(numberFormat: string): string {
  if (!numberFormat) return numberFormat;

  const rawLcid = extractLCID(numberFormat);

  // Strip all [$-XXXX] tokens from the format
  const stripped = numberFormat.replace(LCID_GLOBAL_RE, '');

  if (!rawLcid) {
    // No locale token — return as-is (stripped of any stray tokens)
    return stripped;
  }

  const normalized = normalizeLCID(rawLcid);
  const localeInfo = LCID_TO_LOCALE[normalized];

  if (!localeInfo) {
    // Unknown LCID — graceful fallback: return stripped format
    return stripped;
  }

  // The stored format uses en-US conventions (period decimal, comma thousands).
  // Transform to the target locale's separators.
  return transformSeparators(stripped, EN_US_INFO, localeInfo);
}

/**
 * Encode a locale-specific format string with the appropriate LCID prefix.
 *
 * Takes a format string written in a locale's conventions (e.g., German uses
 * comma for decimal) and converts it to the internal en-US format with LCID prefix.
 *
 * If the locale is unknown or en-US, returns the format as-is (optionally with LCID prefix).
 *
 * @param localFormat - The locale-specific format string (e.g., "#.##0,00" for de-DE)
 * @param locale - BCP-47 locale tag (e.g., "de-DE", "fr-FR")
 * @returns The internal format string with LCID prefix (e.g., "[$-407]#,##0.00")
 */
export function setNumberFormatLocal(localFormat: string, locale: string): string {
  if (!localFormat) return localFormat;

  const lcid = LOCALE_TO_LCID[locale.toLowerCase()];

  if (!lcid) {
    // Unknown locale — store the format as-is (no LCID prefix)
    return localFormat;
  }

  const localeInfo = LCID_TO_LOCALE[lcid];

  // Transform from locale separators to en-US internal format
  const internalFormat = transformSeparators(localFormat, localeInfo, EN_US_INFO);

  // Prepend the LCID token
  return `[$-${lcid}]${internalFormat}`;
}

/**
 * Look up locale info for a given LCID hex string.
 * Returns undefined for unknown LCIDs.
 */
export function getLocaleInfoForLCID(lcid: string): LocaleInfo | undefined {
  return LCID_TO_LOCALE[normalizeLCID(lcid)];
}

/**
 * Get the LCID hex string for a BCP-47 locale tag.
 * Returns undefined for unknown locales.
 */
export function getLCIDForLocale(locale: string): string | undefined {
  return LOCALE_TO_LCID[locale.toLowerCase()];
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Transform number format separators from one locale convention to another.
 *
 * This handles the tricky case where decimal and thousands separators swap
 * (e.g., en-US uses `.` for decimal and `,` for thousands, while de-DE
 * uses `,` for decimal and `.` for thousands).
 *
 * The approach uses placeholder characters to avoid double-swapping.
 *
 * @param format - The format string to transform
 * @param from - The source locale's separator conventions
 * @param to - The target locale's separator conventions
 * @returns The format with separators transformed
 */
function transformSeparators(format: string, from: LocaleInfo, to: LocaleInfo): string {
  if (from.decimalSep === to.decimalSep && from.thousandsSep === to.thousandsSep) {
    return format;
  }

  // Use Unicode private-use area characters as temporary placeholders
  // to avoid conflicts during replacement.
  const DECIMAL_PLACEHOLDER = '\uE001';
  const THOUSANDS_PLACEHOLDER = '\uE002';

  // Step 1: Replace source separators with placeholders.
  // Process format character by character, skipping quoted sections.
  let result = '';
  let inQuote = false;
  let inBracket = false;

  for (let i = 0; i < format.length; i++) {
    const ch = format[i];

    // Track quoted sections (e.g., "text")
    if (ch === '"') {
      inQuote = !inQuote;
      result += ch;
      continue;
    }

    // Track bracketed sections (e.g., [Red], [$EUR])
    if (ch === '[' && !inQuote) {
      inBracket = true;
      result += ch;
      continue;
    }
    if (ch === ']' && !inQuote) {
      inBracket = false;
      result += ch;
      continue;
    }

    // Skip replacement inside quotes or brackets
    if (inQuote || inBracket) {
      result += ch;
      continue;
    }

    // Replace separators with placeholders
    if (ch === from.decimalSep) {
      result += DECIMAL_PLACEHOLDER;
    } else if (ch === from.thousandsSep) {
      result += THOUSANDS_PLACEHOLDER;
    } else {
      result += ch;
    }
  }

  // Step 2: Replace placeholders with target separators
  result = result
    .replace(new RegExp(DECIMAL_PLACEHOLDER, 'g'), to.decimalSep)
    .replace(new RegExp(THOUSANDS_PLACEHOLDER, 'g'), to.thousandsSep);

  return result;
}
