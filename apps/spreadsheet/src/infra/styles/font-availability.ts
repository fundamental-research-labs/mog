/**
 * Font Availability Utilities
 *
 * Provides utilities for detecting missing fonts in imported spreadsheets
 * and suggesting appropriate substitutes.
 *
 */

import type { MissingFontInfo } from '@mog-sdk/contracts/styles';
import { ALL_FONTS, isFontAvailable, SYSTEM_FONTS } from './fonts';

// =============================================================================
// Font Substitution Map
// =============================================================================

/**
 * Map of commonly unavailable fonts to their recommended substitutes.
 * Based on visual similarity and character coverage.
 */
const FONT_SUBSTITUTES: Record<string, string> = {
  // Windows-specific fonts -> cross-platform alternatives
  'Segoe UI': 'Arial',
  Calibri: 'Arial',
  'Calibri Light': 'Arial',
  Cambria: 'Georgia',
  Consolas: 'Courier New',
  Corbel: 'Arial',
  Constantia: 'Georgia',
  Candara: 'Arial',
  'Franklin Gothic Medium': 'Arial',
  Tahoma: 'Arial',

  // macOS-specific fonts -> cross-platform alternatives
  'Helvetica Neue': 'Arial',
  Helvetica: 'Arial',
  'SF Pro': 'Arial',
  'SF Pro Display': 'Arial',
  'SF Pro Text': 'Arial',
  'SF Mono': 'Courier New',
  'New York': 'Georgia',
  Avenir: 'Arial',
  'Avenir Next': 'Arial',

  // CJK fonts -> common CJK alternatives
  'MS Gothic': 'SimSun',
  'MS PGothic': 'SimSun',
  'MS Mincho': 'SimSun',
  'MS PMincho': 'SimSun',
  'Yu Gothic': 'SimSun',
  Meiryo: 'SimSun',
  'Malgun Gothic': 'SimSun',
  Gulim: 'SimSun',
  Dotum: 'SimSun',

  // Script fonts -> common alternatives
  'Brush Script MT': 'Comic Sans MS',
  'Edwardian Script ITC': 'Comic Sans MS',
  Mistral: 'Comic Sans MS',
  'Monotype Corsiva': 'Comic Sans MS',

  // Extended fonts -> system alternatives
  'Book Antiqua': 'Georgia',
  'Bookman Old Style': 'Georgia',
  'Century Gothic': 'Arial',
  Garamond: 'Georgia',
  'Gill Sans MT': 'Arial',
  'Goudy Old Style': 'Georgia',
  'Lucida Bright': 'Georgia',
  Perpetua: 'Georgia',
  Rockwell: 'Georgia',
  'Tw Cen MT': 'Arial',

  // Fallback for common Excel fonts
  Aptos: 'Calibri',
  'Aptos Narrow': 'Arial Narrow',
  'Aptos Display': 'Calibri',
  'Aptos Serif': 'Cambria',
};

/**
 * Get a substitute font for an unavailable font.
 * Returns the most visually similar available font.
 *
 * @param fontFamily - The unavailable font name
 * @returns A substitute font that is available
 */
export function getSubstituteFont(fontFamily: string): string {
  // Check direct mapping first
  if (FONT_SUBSTITUTES[fontFamily]) {
    const substitute = FONT_SUBSTITUTES[fontFamily];
    // Verify the substitute is actually available
    if (isFontAvailable(substitute)) {
      return substitute;
    }
  }

  // Try to find any font from our known list that's available
  // Prioritize system fonts as they're most likely to be available
  for (const font of SYSTEM_FONTS) {
    if (isFontAvailable(font)) {
      return font;
    }
  }

  // Ultimate fallback
  return 'Arial';
}

// =============================================================================
// Font Collection from Cell Data
// =============================================================================

/**
 * Extract unique font families from cell formats.
 *
 * @param fontFamilies - Iterable of font family names from cells
 * @returns Set of unique font family names
 */
export function collectUniqueFonts(fontFamilies: Iterable<string | undefined>): Set<string> {
  const fonts = new Set<string>();

  for (const fontFamily of fontFamilies) {
    if (fontFamily && fontFamily.trim()) {
      fonts.add(fontFamily.trim());
    }
  }

  return fonts;
}

// =============================================================================
// Availability Checking
// =============================================================================

/**
 * Check which fonts are missing (not available in the browser).
 *
 * @param fontFamilies - Set of font family names to check
 * @returns Array of missing font info with substitutes
 */
export function checkMissingFonts(fontFamilies: Set<string>): MissingFontInfo[] {
  const missingFonts: MissingFontInfo[] = [];

  for (const fontFamily of fontFamilies) {
    // Skip checking fonts we know are in our list (they have fallbacks)
    // Only check if the font is actually unavailable
    if (!isFontAvailable(fontFamily)) {
      missingFonts.push({
        originalFont: fontFamily,
        substituteFont: getSubstituteFont(fontFamily),
      });
    }
  }

  // Sort alphabetically for consistent display
  missingFonts.sort((a, b) => a.originalFont.localeCompare(b.originalFont));

  return missingFonts;
}

/**
 * Check if a font is known (in our font list).
 * Known fonts are expected and don't need warnings.
 *
 * @param fontFamily - Font family name to check
 * @returns true if the font is in our known font list
 */
export function isKnownFont(fontFamily: string): boolean {
  return ALL_FONTS.includes(fontFamily);
}

// =============================================================================
// Integration Helper
// =============================================================================

/**
 * Analyze fonts used in imported data and return info about missing fonts.
 * This is the main entry point for checking fonts after XLSX import.
 *
 * @param usedFonts - Array or Set of font names used in the imported file
 * @returns Array of missing font information, empty if all fonts available
 */
export function analyzeImportedFonts(usedFonts: string[] | Set<string>): MissingFontInfo[] {
  const fontSet = usedFonts instanceof Set ? usedFonts : new Set(usedFonts);

  // Filter out empty/default values
  const filteredFonts = new Set<string>();
  for (const font of fontSet) {
    if (font && font.trim() && font !== 'Arial') {
      // Skip Arial as it's always available
      filteredFonts.add(font.trim());
    }
  }

  return checkMissingFonts(filteredFonts);
}
