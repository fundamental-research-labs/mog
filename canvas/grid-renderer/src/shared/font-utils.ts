/**
 * Font Utilities for Canvas Renderer
 *
 * Font fallback chain building and CJK detection for text rendering.
 */

// =============================================================================
// Metric-Compatible Font Fallbacks
// =============================================================================

export const METRIC_COMPATIBLE_FONTS: Record<string, string> = {
  Calibri: 'Carlito',
  'Calibri Light': 'Carlito',
  Cambria: 'Caladea',
};

export const INTRINSIC_FONT_METADATA: Record<string, { fontWeight?: number }> = {
  'Arial Black': { fontWeight: 900 },
};

export function getIntrinsicFontWeight(fontFamily: string): number | undefined {
  return INTRINSIC_FONT_METADATA[fontFamily]?.fontWeight;
}

export function buildFontFamilyWithFallbacks(fontFamily: string): string {
  const parts: string[] = [`"${fontFamily}"`];
  if (fontFamily === 'Arial Black') {
    parts.push('"Arial"', 'sans-serif');
    return parts.join(', ');
  }
  const compatible = METRIC_COMPATIBLE_FONTS[fontFamily];
  if (compatible) {
    parts.push(`"${compatible}"`);
  }
  parts.push('sans-serif');
  return parts.join(', ');
}

// =============================================================================
// CJK Font Fallbacks
// =============================================================================

export const CJK_FONT_FALLBACKS = {
  chinese:
    '"SimSun", "宋体", "SimHei", "Microsoft YaHei", "微软雅黑", "MingLiU", "PMingLiU", sans-serif',
  japanese:
    '"MS Gothic", "MS PGothic", "Hiragino Kaku Gothic Pro", "Yu Gothic", "Meiryo", sans-serif',
  korean: '"Malgun Gothic", "맑은 고딕", Gulim, "굴림", Dotum, "돋움", sans-serif',
} as const;

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

// =============================================================================
// CJK Detection
// =============================================================================

const CJK_REGEX =
  /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u3400-\u4DBF\u3000-\u303F]/;

const HIRAGANA_KATAKANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/;

const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\uA960-\uA97F\uD7B0-\uD7FF]/;

const CJK_IDEOGRAPHS_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

export function detectCJKScript(text: string): boolean {
  if (!text) return false;
  return CJK_REGEX.test(text);
}

export function detectCJKLanguage(text: string): 'zh' | 'ja' | 'ko' | null {
  if (!text) return null;
  if (HIRAGANA_KATAKANA_REGEX.test(text)) return 'ja';
  if (HANGUL_REGEX.test(text)) return 'ko';
  if (CJK_IDEOGRAPHS_REGEX.test(text)) return 'zh';
  return null;
}

// =============================================================================
// CJK Detection Cache
// =============================================================================

const cjkDetectionCache = new Map<string, { hasCJK: boolean; lang: 'zh' | 'ja' | 'ko' | null }>();
const MAX_CJK_CACHE_SIZE = 10000;

export function getCachedCJKInfo(text: string): {
  hasCJK: boolean;
  lang: 'zh' | 'ja' | 'ko' | null;
} {
  const cached = cjkDetectionCache.get(text);
  if (cached) return cached;

  const hasCJK = detectCJKScript(text);
  const lang = hasCJK ? detectCJKLanguage(text) : null;
  const result = { hasCJK, lang };

  if (cjkDetectionCache.size >= MAX_CJK_CACHE_SIZE) {
    cjkDetectionCache.clear();
  }
  cjkDetectionCache.set(text, result);

  return result;
}

export function clearCJKCache(): void {
  cjkDetectionCache.clear();
}
