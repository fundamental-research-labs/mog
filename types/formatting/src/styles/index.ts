/**
 * Styles Module - Types Only
 *
 * Runtime code (BUILT_IN_STYLES, helper functions, category constants)
 * has been moved to @mog-sdk/kernel/domain/cells/built-in-styles.
 *
 * This module retains only type exports.
 */

/**
 * Information about a missing font detected during import.
 */
export interface MissingFontInfo {
  /** The font name from the XLSX file that is not available */
  originalFont: string;
  /** The font that will be used as a substitute */
  substituteFont: string;
}
