/**
 * Cell Style Adapters - Platform-Specific Rendering
 *
 * Converts the canonical CellTextStyle from contracts into platform-specific formats:
 * - Canvas: ctx.font string, text positioning
 * - DOM: CSSProperties for in-cell editor
 *
 * ARCHITECTURAL CONTRACT:
 * - These adapters consume resolveCellTextStyle() from @mog-sdk/contracts
 * - Both canvas and DOM rendering MUST use these adapters
 * - This ensures WYSIWYG: canvas and DOM render identically
 *
 * THEME INTEGRATION (Issue 4: Page Layout - Themes):
 * - All functions accept an optional ThemeDefinition parameter
 * - Theme color references (e.g., 'theme:accent1') are resolved via composition
 * - Theme font references (fontTheme: 'major' | 'minor') are resolved to actual fonts
 * - Pattern: resolveAllThemeRefs(format, theme) -> resolveCellTextStyle(resolved)
 * - This preserves the resolveCellTextStyle API while adding theme support
 *
 * THEME FONTS:
 * - Cells can use fontTheme: 'major' for headings font (e.g., 'Calibri Light')
 * - Cells can use fontTheme: 'minor' for body font (e.g., 'Calibri')
 * - Resolution happens at render time, so cells update when theme changes
 *
 * @see contracts/src/cell-style.ts for the source of truth
 * @see contracts/src/theme.ts for theme resolution
 */

import {
  buildFontFamilyWithFallbacks,
  getCachedCJKInfo,
  getCJKFallbackChain,
  getIntrinsicFontWeight,
  OFFICE_THEME,
} from '@mog/grid-renderer';
import type { CellTextStyle } from '@mog-sdk/contracts/cell-style';
import { resolveCellTextStyle } from '@mog/spreadsheet-utils/cells/cell-style';
import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { resolveAllThemeRefs } from '@mog/spreadsheet-utils/formatting/theme';
import type { CSSProperties } from 'react';

// =============================================================================
// Canvas Adapters
// =============================================================================

/**
 * Build canvas ctx.font string from cell format.
 *
 * The font string follows CSS font shorthand order:
 * [font-style] [font-weight] font-size font-family
 *
 * When cellContent is provided and contains CJK characters, the appropriate
 * CJK fallback font chain is automatically appended.
 *
 * When previewFont is provided (from font picker hover), it temporarily
 * overrides the cell's actual fontFamily for live preview.
 *
 * @example
 * getCellCanvasFont({ bold: true, fontSize: 14 }, theme)
 * // => "bold 14px Inter, -apple-system, ..."
 *
 * getCellCanvasFont({ fontFamily: 'Arial' }, theme, '你好')
 * // => "14px Arial, "SimSun", "宋体", ..."
 *
 * getCellCanvasFont({ fontFamily: 'Arial' }, theme, undefined, 'Times New Roman')
 * // => "14px Times New Roman, ..." (preview font overrides actual font)
 *
 * @param format - Cell format (or undefined for defaults)
 * @param theme - Theme for resolving theme color references (defaults to Office theme)
 * @param cellContent - Optional cell content for CJK detection and fallback
 * @param previewFont - Optional preview font from font picker hover
 * @returns CSS font string for canvas context
 */
export function getCellCanvasFont(
  format: CellFormat | undefined,
  theme: ThemeDefinition = OFFICE_THEME,
  cellContent?: string,
  previewFont?: string | null,
): string {
  // Step 1: Resolve all theme references (colors AND fonts) to concrete values
  const resolvedFormat = resolveAllThemeRefs(format, theme);
  // Step 2: Compute text style (unchanged API)
  const style = resolveCellTextStyle(resolvedFormat);
  const parts: string[] = [];

  // Order matters for CSS font shorthand: style weight size family
  if (style.fontStyle === 'italic') {
    parts.push('italic');
  }

  // Step 3: Build font family with fallbacks
  // - Preview font (from font picker hover) takes priority
  // - Otherwise use the resolved fontFamily from format
  // - Apply metric-compatible fallbacks (e.g., Calibri → Carlito)
  // - Add CJK fallback chain if content contains CJK characters
  const baseFontFamily = previewFont || style.fontFamily;

  // Extract the primary font name for fallback lookup
  // (style.fontFamily might be a stack like "Inter, -apple-system, ...")
  const primaryFont = baseFontFamily.split(',')[0].trim().replace(/["']/g, '');
  const intrinsicWeight = getIntrinsicFontWeight(primaryFont);
  if (intrinsicWeight != null) {
    parts.push(String(intrinsicWeight));
  } else if (style.fontWeight === 'bold') {
    parts.push('bold');
  }
  parts.push(`${style.fontSize}px`);
  let fontFamily = buildFontFamilyWithFallbacks(primaryFont);

  // Add CJK fallback chain if needed
  if (cellContent) {
    const { hasCJK, lang } = getCachedCJKInfo(cellContent);
    if (hasCJK && lang) {
      // Insert CJK fonts before the generic sans-serif
      const cjkFallback = getCJKFallbackChain(lang);
      fontFamily = fontFamily.replace(/, sans-serif$/, `, ${cjkFallback}`);
    }
  }
  parts.push(fontFamily);

  return parts.join(' ');
}

/**
 * Get the resolved cell text style with theme colors applied.
 * Use this when you need multiple properties (positioning, colors, etc.)
 *
 * @param format - Cell format (or undefined for defaults)
 * @param theme - Theme for resolving theme color references (defaults to Office theme)
 * @returns Complete resolved style with theme colors resolved to hex
 */
export function getThemedCellStyle(
  format: CellFormat | undefined,
  theme: ThemeDefinition = OFFICE_THEME,
  value?: CellValue,
): CellTextStyle {
  // Apply composition pattern: resolve all theme refs (colors + fonts), then compute style
  const resolvedFormat = resolveAllThemeRefs(format, theme);
  return resolveCellTextStyle(resolvedFormat, value);
}

// =============================================================================
// DOM Adapters
// =============================================================================

/**
 * Get DOM inline styles for in-cell editor.
 *
 * Produces CSSProperties that render identically to canvas cell rendering.
 *
 * WYSIWYG vertical alignment:
 * - Canvas uses `textBaseline='middle'` at `cellY + cellHeight/2`
 * - DOM achieves the same by setting `line-height` equal to cell height
 * - This centers the single line of text vertically, matching canvas exactly
 *
 * NOTE: For true WYSIWYG inline cell editing, prefer using computeTextPosition()
 * from TextMeasurementService. It returns exact (x, y) coordinates that guarantee
 * canvas and DOM render identically. This function is still useful for non-WYSIWYG
 * contexts like dialogs, tooltips, and preview UI.
 *
 * When cellContent is provided and contains CJK characters, the appropriate
 * CJK fallback font chain is automatically appended.
 *
 * When previewFont is provided (from font picker hover), it temporarily
 * overrides the cell's actual fontFamily for live preview.
 *
 * @example
 * <input style={getCellDOMStyle(cellFormat, cellRect.height, 'var(--surface)', theme)} />
 *
 * @param format - Cell format (or undefined for defaults)
 * @param cellHeight - Cell height in pixels (required for WYSIWYG vertical centering)
 * @param surfaceColor - Fallback background color when cell has no background
 * @param theme - Theme for resolving theme color references (defaults to Office theme)
 * @param cellContent - Optional cell content for CJK detection and fallback
 * @param previewFont - Optional preview font from font picker hover
 * @returns CSSProperties for the in-cell editor
 */
export function getCellDOMStyle(
  format: CellFormat | undefined,
  cellHeight: number,
  surfaceColor: string = 'var(--color-ss-surface, #ffffff)',
  theme: ThemeDefinition = OFFICE_THEME,
  cellContent?: string,
  previewFont?: string | null,
  value?: CellValue,
): CSSProperties {
  // Apply composition pattern: resolve all theme refs (colors + fonts), then compute style
  const resolvedFormat = resolveAllThemeRefs(format, theme);
  const style = resolveCellTextStyle(resolvedFormat, value);

  // Build font family with fallbacks
  // - Preview font (from font picker hover) takes priority
  // - Otherwise use the resolved fontFamily from format
  // - Apply metric-compatible fallbacks (e.g., Calibri → Carlito)
  // - Add CJK fallback chain if content contains CJK characters
  const baseFontFamily = previewFont || style.fontFamily;
  const primaryFont = baseFontFamily.split(',')[0].trim().replace(/["']/g, '');
  const intrinsicWeight = getIntrinsicFontWeight(primaryFont);
  let fontFamily = buildFontFamilyWithFallbacks(primaryFont);

  if (cellContent) {
    const { hasCJK, lang } = getCachedCJKInfo(cellContent);
    if (hasCJK && lang) {
      // Insert CJK fonts before the generic sans-serif
      fontFamily = fontFamily.replace(/, sans-serif$/, `, ${getCJKFallbackChain(lang)}`);
    }
  }

  // Vertical alignment strategy:
  // - 'middle': Use line-height = cellHeight for perfect centering (matches canvas textBaseline='middle')
  // - 'top': Use padding-top to push text down from top edge
  // - 'bottom': Use line-height + vertical-align to push text to bottom
  //
  // NOTE: These CSS tricks are used for non-WYSIWYG contexts (dialogs, tooltips).
  // For WYSIWYG inline editors, use computeTextPosition() from TextMeasurementService
  // which returns exact (x, y) coordinates that match canvas rendering.
  let verticalStyles: CSSProperties;

  switch (style.verticalAlign) {
    case 'top':
      verticalStyles = {
        paddingTop: style.paddingX, // Same as horizontal for consistency
        paddingBottom: 0,
        lineHeight: 1,
      };
      break;
    case 'bottom':
      // For bottom alignment, we need the text at the bottom of the cell
      // Use line-height: 1 and position via padding
      verticalStyles = {
        paddingTop: 0,
        paddingBottom: style.paddingX,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'flex-end',
      };
      break;
    case 'middle':
    default:
      // KEY: line-height = cellHeight centers text exactly like canvas textBaseline='middle'
      // Canvas draws at y + height/2 with textBaseline='middle'
      // DOM with line-height=height centers the line box identically
      verticalStyles = {
        paddingTop: 0,
        paddingBottom: 0,
        lineHeight: `${cellHeight}px`,
      };
      break;
  }

  return {
    // Horizontal padding
    paddingLeft: style.paddingX,
    paddingRight: style.paddingX,

    // Vertical alignment (varies by alignment type)
    ...verticalStyles,

    // Typography
    fontSize: style.fontSize,
    fontFamily, // Uses computed fontFamily with CJK fallback if needed
    fontWeight: intrinsicWeight ?? style.fontWeight,
    fontStyle: style.fontStyle,
    color: style.color,
    textDecoration: style.textDecoration,
    textAlign: style.textAlign,

    // Background: use cell's background or fallback to surface
    // (transparent would show grid lines through editor, which is distracting)
    backgroundColor: style.backgroundColor ?? surfaceColor,

    // Reset any inherited styles that could interfere
    border: 'none',
    margin: 0,
    boxSizing: 'border-box',
  };
}

// =============================================================================
// Type Re-export (only CellTextStyle - return type of getThemedCellStyle)
// =============================================================================

// Only re-export types that are part of THIS module's public API
export type { CellTextStyle } from '@mog-sdk/contracts/cell-style';

// NOTE: Consumers should import directly from the source:
// - ThemeDefinition, resolveThemeColors → '@mog-sdk/contracts'
// - OFFICE_THEME, getTheme → '../styles/built-in-themes'
