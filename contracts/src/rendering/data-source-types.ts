/**
 * Data Source Shared Types
 *
 * Types shared between `./data-sources.ts` and `./render-context.ts`.
 * Extracted to break the cycle between those two modules — both now import
 * from this leaf file instead of from each other.
 *
 * @module @mog-sdk/contracts/rendering/data-source-types
 */

// =============================================================================
// Chrome Theme
// =============================================================================

/**
 * Theme colors for the spreadsheet chrome — the UI shell surrounding cell content.
 *
 * Controls canvas background, gridlines, headers, selection indicators,
 * scrollbars, and drag-drop overlays. Cell content colors are governed by
 * ThemeDefinition / conditional formatting, not this interface.
 */
export interface ChromeTheme {
  canvasBackground: string;
  gridlineColor: string;
  headerBackground: string;
  headerText: string;
  headerBorder: string;
  headerHighlightBackground: string;
  headerHighlightText: string;
  selectionFill: string;
  selectionBorder: string;
  activeCellBorder: string;
  fillHandleColor: string;
  dragSourceColor: string;
  dragTargetColor: string;
  scrollbarTrack: string;
  scrollbarThumb: string;
}

/**
 * Default chrome theme — the single source of truth for all canvas chrome colors.
 * Layers read colors from `sheetData.chromeTheme` at render time; this object
 * provides the initial/fallback values.
 */
export const DEFAULT_CHROME_THEME: ChromeTheme = {
  canvasBackground: '#ffffff',
  gridlineColor: '#e0e0e0',
  headerBackground: '#f8f9fa',
  headerText: '#333333',
  headerBorder: '#dadce0',
  headerHighlightBackground: '#e8eaed',
  headerHighlightText: '#217346',
  selectionFill: 'rgba(33, 115, 70, 0.1)',
  selectionBorder: '#217346',
  activeCellBorder: '#217346',
  fillHandleColor: '#217346',
  dragSourceColor: 'rgba(33, 115, 70, 0.15)',
  dragTargetColor: '#217346',
  scrollbarTrack: '#f1f1f1',
  scrollbarThumb: '#c1c1c1',
};
