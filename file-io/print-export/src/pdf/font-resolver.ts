/**
 * Font Resolver -- maps font family names to PDF FontHandle objects.
 *
 * SCAFFOLD: This implementation maps fonts to the PDF base-14 fonts
 * (Helvetica, Times-Roman, Courier). It will be replaced by a real
 * TrueType font pipeline.
 *
 * The resolver categorizes font families into three groups:
 * - Sans-serif (Calibri, Arial, Helvetica, etc.) -> Helvetica
 * - Serif (Cambria, Times New Roman, Georgia, etc.) -> Times-Roman
 * - Monospace (Consolas, Courier New, etc.) -> Courier
 */

import type { FontHandle } from '@mog/pdf-graphics';

// ============================================================================
// FontResolver Interface
// ============================================================================

/**
 * Interface for resolving font family + weight + style to a FontHandle.
 */
export interface FontResolver {
  resolve(family: string, bold: boolean, italic: boolean): FontHandle;
}

// ============================================================================
// Font Family Classification
// ============================================================================

/** Font families that map to Helvetica (sans-serif). */
const SANS_SERIF_FAMILIES = new Set([
  'arial',
  'calibri',
  'helvetica',
  'verdana',
  'tahoma',
  'trebuchet ms',
  'segoe ui',
  'open sans',
  'roboto',
  'lato',
  'source sans pro',
  'noto sans',
  'gill sans',
  'franklin gothic',
  'century gothic',
  'lucida sans',
  'sans-serif',
  'sans',
]);

/** Font families that map to Times-Roman (serif). */
const SERIF_FAMILIES = new Set([
  'times',
  'times new roman',
  'times-roman',
  'cambria',
  'georgia',
  'garamond',
  'palatino',
  'book antiqua',
  'palatino linotype',
  'baskerville',
  'century schoolbook',
  'lucida bright',
  'rockwell',
  'serif',
]);

/** Font families that map to Courier (monospace). */
const MONOSPACE_FAMILIES = new Set([
  'courier',
  'courier new',
  'consolas',
  'monaco',
  'lucida console',
  'andale mono',
  'menlo',
  'dejavu sans mono',
  'source code pro',
  'fira code',
  'jetbrains mono',
  'monospace',
  'mono',
]);

/**
 * Classify a font family name into a base-14 family category.
 */
function classifyFamily(family: string): 'helvetica' | 'times' | 'courier' {
  const normalized = family.toLowerCase().trim();

  if (MONOSPACE_FAMILIES.has(normalized)) return 'courier';
  if (SERIF_FAMILIES.has(normalized)) return 'times';
  if (SANS_SERIF_FAMILIES.has(normalized)) return 'helvetica';

  // Default to Helvetica for unknown fonts
  return 'helvetica';
}

// ============================================================================
// DefaultFontResolver
// ============================================================================

/**
 * Default font resolver that maps to PDF base-14 fonts.
 *
 * SCAFFOLD: This will be replaced by real font embedding.
 * For now, all fonts are mapped to Helvetica, Times-Roman, or Courier
 * with appropriate weight/style variants.
 */
export class DefaultFontResolver implements FontResolver {
  /** Cache resolved fonts to avoid creating duplicate FontHandle objects. */
  private cache = new Map<string, FontHandle>();

  resolve(family: string, bold: boolean, italic: boolean): FontHandle {
    const cacheKey = `${family.toLowerCase().trim()}|${bold}|${italic}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const base14Family = classifyFamily(family);
    const weight: 'normal' | 'bold' = bold ? 'bold' : 'normal';
    const style: 'normal' | 'italic' = italic ? 'italic' : 'normal';

    const handle: FontHandle = {
      id: `${base14Family}-${weight}-${style}`,
      family: base14Family,
      weight,
      style,
    };

    this.cache.set(cacheKey, handle);
    return handle;
  }

  /** Clear the internal cache. Useful for testing. */
  clearCache(): void {
    this.cache.clear();
  }
}
