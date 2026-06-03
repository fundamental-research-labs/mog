/**
 * Font Definitions for Enhanced Font Picker
 *
 * Extended font list with categories for Excel/SpreadJS parity.
 * Includes recent fonts persistence via localStorage.
 *
 */

// =============================================================================
// Metric-Compatible Font Fallbacks
// =============================================================================

/**
 * Map of Microsoft Office fonts to metric-compatible open-source fallbacks.
 *
 * These fonts are chosen to preserve Office document line breaks and column widths.
 *
 * The alternatives are loaded from checked-in font files in globals.css.
 *
 * @see https://fonts.google.com/specimen/Carlito (Calibri alternative)
 * @see https://fonts.google.com/specimen/Caladea (Cambria alternative)
 */
export const METRIC_COMPATIBLE_FONTS: Record<string, string> = {
  // Carlito is a metric-compatible fallback for Calibri
  Calibri: 'Carlito',
  'Calibri Light': 'Carlito', // Carlito covers light weight via CSS font-weight

  // Caladea is a metric-compatible fallback for Cambria
  Cambria: 'Caladea',
};

const METRIC_COMPATIBLE_FONT_LOADS = [
  'normal 400 11px "Carlito"',
  'normal 700 11px "Carlito"',
  'italic 400 11px "Carlito"',
  'italic 700 11px "Carlito"',
  'normal 400 11px "Caladea"',
  'normal 700 11px "Caladea"',
  'italic 400 11px "Caladea"',
  'italic 700 11px "Caladea"',
] as const;

let metricCompatibleFontsPromise: Promise<void> | null = null;

export function ensureMetricCompatibleFontsLoaded(): Promise<void> {
  if (
    typeof document === 'undefined' ||
    !('fonts' in document) ||
    typeof document.fonts.load !== 'function'
  ) {
    return Promise.resolve();
  }

  metricCompatibleFontsPromise ??= Promise.all(
    METRIC_COMPATIBLE_FONT_LOADS.map((font) => document.fonts.load(font)),
  )
    .then(() => document.fonts.ready)
    .catch((error: unknown) => {
      console.warn('[Spreadsheet] Failed to preload metric-compatible fonts', error);
    })
    .then(() => undefined);

  return metricCompatibleFontsPromise;
}

/**
 * Build a CSS font-family string with metric-compatible fallbacks.
 *
 * If the font has a metrically-compatible alternative (e.g., Calibri → Carlito),
 * it will be included in the fallback chain. This ensures:
 * 1. If the user has the original font installed, it's used
 * 2. If not, the metrically-compatible alternative is used (same layout)
 * 3. Final fallback to generic sans-serif
 *
 * @param fontFamily - The primary font family (e.g., "Calibri")
 * @returns CSS font-family string with fallbacks (e.g., '"Calibri", "Carlito", sans-serif')
 *
 * @example
 * buildFontFamilyWithFallbacks('Calibri')
 * // Returns: '"Calibri", "Carlito", sans-serif'
 *
 * buildFontFamilyWithFallbacks('Arial')
 * // Returns: '"Arial", sans-serif'
 */
export function buildFontFamilyWithFallbacks(fontFamily: string): string {
  const parts: string[] = [`"${fontFamily}"`];

  // Add metric-compatible fallback if available
  const compatible = METRIC_COMPATIBLE_FONTS[fontFamily];
  if (compatible) {
    parts.push(`"${compatible}"`);
  }

  // Add generic fallback
  parts.push('sans-serif');

  return parts.join(', ');
}

// =============================================================================
// Font Categories
// =============================================================================

/**
 * System fonts that are widely available across platforms.
 * These are the primary fonts shown in the picker.
 */
export const SYSTEM_FONTS = [
  'Arial',
  'Courier New',
  'Arial Black',
  'Arial Narrow',
  'Calibri',
  'Calibri Light',
  'Cambria',
  'Century Gothic',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Georgia',
  'Impact',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
] as const;

/**
 * Monospace fonts for code or tabular data.
 */
export const MONOSPACE_FONTS = [
  'Consolas',
  'Courier New',
  'Lucida Console',
  'Monaco',
  'Source Code Pro',
  'Menlo',
  'SF Mono',
] as const;

/**
 * Extended fonts for Excel/SpreadJS parity (C1).
 * Additional professional fonts commonly used in office applications.
 */
export const EXTENDED_FONTS = [
  'Aptos',
  'Aptos Narrow',
  'Aptos Display',
  'Aptos Serif',
  'Bahnschrift',
  'Book Antiqua',
  'Bookman Old Style',
  'Cambria',
  'Cambria Math',
  'Candara',
  'Candara Light',
  'Century',
  'Century Schoolbook',
  'Constantia',
  'Corbel',
  'Franklin Gothic Medium',
  'Garamond',
  'Gill Sans MT',
  'Gloucester MT Extra Condensed',
  'Goudy Old Style',
  'Lucida Bright',
  'Lucida Fax',
  'Perpetua',
  'Rockwell',
  'Rockwell Condensed',
  'Tw Cen MT',
] as const;

/**
 * Script fonts for decorative text (C1).
 * Handwriting and calligraphic style fonts.
 */
export const SCRIPT_FONTS = [
  'Brush Script MT',
  'Edwardian Script ITC',
  'Freestyle Script',
  'French Script MT',
  'Kunstler Script',
  'Lucida Calligraphy',
  'Lucida Handwriting',
  'Mistral',
  'Monotype Corsiva',
  'Palace Script MT',
  'Script MT Bold',
] as const;

/**
 * Symbol fonts for special characters (C1).
 * Icon and symbol fonts for special purposes.
 */
export const SYMBOL_FONTS = [
  'Marlett',
  'MS Outlook',
  'Symbol',
  'Webdings',
  'Wingdings',
  'Wingdings 2',
  'Wingdings 3',
] as const;

/**
 * macOS platform fonts (Fonts/Typography).
 * Common macOS system fonts for better cross-platform support.
 *
 * Note on San Francisco:
 * - San Francisco is NOT directly addressable by name
 * - Use 'SF Pro', 'SF Pro Display', or 'SF Pro Text' instead
 * - '-apple-system' and 'system-ui' are CSS aliases, not font names
 */
export const MACOS_FONTS = [
  'Helvetica Neue',
  'Helvetica',
  'SF Pro',
  'SF Pro Display',
  'SF Pro Text',
  'SF Mono',
  'New York',
  'Avenir',
  'Avenir Next',
] as const;

/**
 * CJK (Chinese, Japanese, Korean) fonts (C3).
 * Fonts optimized for displaying East Asian characters.
 */
export const CJK_FONTS = [
  // Japanese
  'MS Gothic',
  'MS PGothic',
  'MS UI Gothic',
  'MS Mincho',
  'MS PMincho',
  // Chinese Simplified
  'SimSun',
  'SimHei',
  'NSimSun',
  // Chinese Traditional
  'MingLiU',
  'PMingLiU',
  // Korean
  'Malgun Gothic',
  'Gulim',
  'Dotum',
  'Batang',
] as const;

/**
 * CJK font fallback chains for different languages (C3).
 * Ensures proper rendering when primary font is unavailable.
 * Extended with comprehensive fallbacks for cross-platform support.
 */
export const CJK_FONT_FALLBACKS = {
  chinese:
    '"SimSun", "宋体", "SimHei", "Microsoft YaHei", "微软雅黑", "MingLiU", "PMingLiU", sans-serif',
  japanese:
    '"MS Gothic", "MS PGothic", "Hiragino Kaku Gothic Pro", "Yu Gothic", "Meiryo", sans-serif',
  korean: '"Malgun Gothic", "맑은 고딕", Gulim, "굴림", Dotum, "돋움", sans-serif',
} as const;

/**
 * Get the appropriate CJK fallback chain for a language.
 * Returns a CSS font-family value with fallbacks.
 *
 * @param lang - Language code: 'zh' (Chinese), 'ja' (Japanese), 'ko' (Korean)
 * @returns Font family string with fallback chain
 */
export function getCJKFallbackChain(lang?: 'zh' | 'ja' | 'ko'): string {
  switch (lang) {
    case 'ja':
      return CJK_FONT_FALLBACKS.japanese;
    case 'ko':
      return CJK_FONT_FALLBACKS.korean;
    case 'zh':
    default:
      return CJK_FONT_FALLBACKS.chinese;
  }
}

/**
 * All font categories for the picker.
 */
export const FONT_CATEGORIES = {
  system: [...SYSTEM_FONTS],
  extended: [...EXTENDED_FONTS],
  script: [...SCRIPT_FONTS],
  symbol: [...SYMBOL_FONTS],
  monospace: [...MONOSPACE_FONTS],
  macos: [...MACOS_FONTS],
  cjk: [...CJK_FONTS],
} as const;

/**
 * Flat list of all available fonts (deduplicated).
 */
export const ALL_FONTS: readonly string[] = [
  ...new Set([
    ...SYSTEM_FONTS,
    ...EXTENDED_FONTS,
    ...SCRIPT_FONTS,
    ...SYMBOL_FONTS,
    ...MONOSPACE_FONTS,
    ...MACOS_FONTS,
    ...CJK_FONTS,
  ]),
].sort();

// =============================================================================
// Recent Fonts Persistence
// =============================================================================

/** localStorage key for recent fonts */
export const RECENT_FONTS_KEY = 'spreadsheet:recentFonts';

/** Maximum number of recent fonts to track */
export const MAX_RECENT_FONTS = 10;

/**
 * Get recent fonts from localStorage.
 */
export function getRecentFonts(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(RECENT_FONTS_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    // Filter to only valid fonts and limit to max
    return parsed
      .filter((f): f is string => typeof f === 'string' && ALL_FONTS.includes(f))
      .slice(0, MAX_RECENT_FONTS);
  } catch {
    return [];
  }
}

/**
 * Add a font to the recent fonts list.
 * Moves the font to the front if it already exists.
 */
export function addRecentFont(fontFamily: string): void {
  if (typeof window === 'undefined') return;
  if (!ALL_FONTS.includes(fontFamily)) return;

  try {
    const current = getRecentFonts();

    // Remove if already exists (will be added to front)
    const filtered = current.filter((f) => f !== fontFamily);

    // Add to front and limit
    const updated = [fontFamily, ...filtered].slice(0, MAX_RECENT_FONTS);

    localStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Clear recent fonts from localStorage.
 */
export function clearRecentFonts(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(RECENT_FONTS_KEY);
  } catch {
    // Ignore localStorage errors
  }
}

// =============================================================================
// Font Detection
// =============================================================================

/**
 * Check if a font is available in the browser.
 * Uses canvas measurement to detect font availability.
 */
export function isFontAvailable(fontFamily: string): boolean {
  if (typeof document === 'undefined') return true;

  // Use a test string with varied characters
  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';
  const baseFonts = ['monospace', 'sans-serif', 'serif'];

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return true;

  // Measure with base fonts
  const baseWidths: Record<string, number> = {};
  for (const baseFont of baseFonts) {
    context.font = `${testSize} ${baseFont}`;
    baseWidths[baseFont] = context.measureText(testString).width;
  }

  // Check if the font produces different measurements
  for (const baseFont of baseFonts) {
    context.font = `${testSize} '${fontFamily}', ${baseFont}`;
    const testWidth = context.measureText(testString).width;
    if (testWidth !== baseWidths[baseFont]) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// Font Category Helpers
// =============================================================================

/**
 * Category labels for UI display.
 */
export const FONT_CATEGORY_LABELS: Record<keyof typeof FONT_CATEGORIES, string> = {
  system: 'System Fonts',
  extended: 'Extended Fonts',
  script: 'Script Fonts',
  symbol: 'Symbol Fonts',
  monospace: 'Monospace',
  macos: 'macOS Fonts',
  cjk: 'CJK Fonts',
};

/**
 * Check if a font is monospace.
 */
export function isMonospaceFont(fontFamily: string): boolean {
  return MONOSPACE_FONTS.includes(fontFamily as (typeof MONOSPACE_FONTS)[number]);
}

// =============================================================================
// CJK Detection (Fonts/Typography)
// =============================================================================

/**
 * Unicode ranges for CJK script detection.
 * Reference: Unicode Standard, Chapter 18 (East Asian Scripts)
 */
export const UNICODE_RANGES = {
  // CJK Unified Ideographs (common to Chinese, Japanese, Korean)
  CJK_UNIFIED: {
    main: [0x4e00, 0x9fff], // CJK Unified Ideographs
    extA: [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
    extB: [0x20000, 0x2a6df], // CJK Unified Ideographs Extension B
    extC: [0x2a700, 0x2b73f], // CJK Unified Ideographs Extension C
    extD: [0x2b740, 0x2b81f], // CJK Unified Ideographs Extension D
    extE: [0x2b820, 0x2ceaf], // CJK Unified Ideographs Extension E
    extF: [0x2ceb0, 0x2ebef], // CJK Unified Ideographs Extension F
    compat: [0xf900, 0xfaff], // CJK Compatibility Ideographs
  },

  // Japanese-specific
  HIRAGANA: [0x3040, 0x309f],
  KATAKANA: [0x30a0, 0x30ff],
  KATAKANA_EXT: [0x31f0, 0x31ff],
  HALFWIDTH_KATAKANA: [0xff65, 0xff9f],

  // Korean-specific
  HANGUL_JAMO: [0x1100, 0x11ff],
  HANGUL_COMPAT_JAMO: [0x3130, 0x318f],
  HANGUL_SYLLABLES: [0xac00, 0xd7af],
  HANGUL_JAMO_EXT_A: [0xa960, 0xa97f],
  HANGUL_JAMO_EXT_B: [0xd7b0, 0xd7ff],

  // Chinese-specific punctuation
  CJK_SYMBOLS: [0x3000, 0x303f],
  CJK_PUNCTUATION: [0xfe30, 0xfe4f],

  // Bopomofo (Traditional Chinese phonetic)
  BOPOMOFO: [0x3100, 0x312f],
  BOPOMOFO_EXT: [0x31a0, 0x31bf],
} as const;

/**
 * Combined regex for CJK detection (most common ranges first for performance).
 * Includes: CJK Unified Ideographs, Hiragana, Katakana, Hangul, CJK symbols.
 */
const CJK_REGEX =
  /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u3400-\u4DBF\u3000-\u303F]/;

/**
 * Japanese-specific scripts: Hiragana, Katakana, extended Katakana, halfwidth Katakana.
 */
const HIRAGANA_KATAKANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/;

/**
 * Korean-specific scripts: Hangul Jamo and Syllables.
 */
const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\uA960-\uA97F\uD7B0-\uD7FF]/;

/**
 * CJK Unified Ideographs (shared by Chinese, Japanese, Korean).
 */
const CJK_IDEOGRAPHS_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

/**
 * Detects if text contains CJK characters.
 * Performance: O(n) where n is text length, but short-circuits on first match.
 *
 * @param text - The text to check
 * @returns true if any CJK character is found
 */
export function detectCJKScript(text: string): boolean {
  if (!text) return false;
  return CJK_REGEX.test(text);
}

/**
 * Detects the dominant CJK language in text.
 * Uses script-specific characters to disambiguate.
 *
 * Detection priority:
 * 1. If Hiragana or Katakana present -> Japanese
 * 2. If Hangul present -> Korean
 * 3. If only CJK ideographs -> Chinese (default)
 *
 * @param text - The text to analyze
 * @returns 'zh' | 'ja' | 'ko' | null
 */
export function detectCJKLanguage(text: string): 'zh' | 'ja' | 'ko' | null {
  if (!text) return null;

  // Check for Japanese-specific scripts (highest priority)
  if (HIRAGANA_KATAKANA_REGEX.test(text)) {
    return 'ja';
  }

  // Check for Korean-specific scripts
  if (HANGUL_REGEX.test(text)) {
    return 'ko';
  }

  // Check for CJK ideographs (defaults to Chinese if no Japanese/Korean markers)
  if (CJK_IDEOGRAPHS_REGEX.test(text)) {
    return 'zh';
  }

  return null;
}

// =============================================================================
// CJK Detection Cache (Performance Optimization)
// =============================================================================

/**
 * Cache for CJK detection results to avoid repeated regex tests.
 */
const cjkDetectionCache = new Map<string, { hasCJK: boolean; lang: 'zh' | 'ja' | 'ko' | null }>();

/** Maximum cache size before clearing. */
const MAX_CJK_CACHE_SIZE = 10000;

/**
 * Gets CJK info with caching for performance.
 * Results are cached to avoid repeated regex tests on the same text.
 *
 * @param text - The text to analyze
 * @returns Object with hasCJK boolean and detected language
 */
export function getCachedCJKInfo(text: string): {
  hasCJK: boolean;
  lang: 'zh' | 'ja' | 'ko' | null;
} {
  // Check cache first
  const cached = cjkDetectionCache.get(text);
  if (cached) return cached;

  // Compute if not cached
  const hasCJK = detectCJKScript(text);
  const lang = hasCJK ? detectCJKLanguage(text) : null;
  const result = { hasCJK, lang };

  // Add to cache (with size limit)
  if (cjkDetectionCache.size >= MAX_CJK_CACHE_SIZE) {
    // Clear oldest entries (simple strategy: clear all)
    cjkDetectionCache.clear();
  }
  cjkDetectionCache.set(text, result);

  return result;
}

/**
 * Clears the CJK detection cache.
 * Call when sheet changes or on large edits.
 */
export function clearCJKCache(): void {
  cjkDetectionCache.clear();
}

/**
 * For initial render, batch-detect CJK in visible cells.
 * This is more efficient than per-cell detection.
 *
 * @param texts - Array of text strings to analyze
 * @returns Map of text to CJK info
 */
export function batchDetectCJK(
  texts: string[],
): Map<string, { hasCJK: boolean; lang: 'zh' | 'ja' | 'ko' | null }> {
  const results = new Map<string, { hasCJK: boolean; lang: 'zh' | 'ja' | 'ko' | null }>();
  for (const text of texts) {
    results.set(text, getCachedCJKInfo(text));
  }
  return results;
}
