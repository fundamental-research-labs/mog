/**
 * WorkbookTheme -- Theme management sub-API interface.
 *
 * Two orthogonal theme concepts:
 * - **Workbook theme** (ThemeDefinition): OOXML 12-slot color palette + font pair.
 *   Stored in the document (CRDT), resolved by Rust. Async bridge calls.
 * - **Chrome theme** (ChromeTheme): Canvas UI shell colors (gridlines, headers, etc.).
 *   TS-only session config, not persisted. Synchronous.
 */
import type { ThemeDefinition } from '@mog/types-formatting/formatting/theme';
import type { ChromeTheme } from '@mog/types-rendering/data-sources';

export interface WorkbookTheme {
  /**
   * Get the workbook's OOXML theme definition (color palette + fonts).
   * Reads from Rust via bridge — async.
   */
  getWorkbookTheme(): Promise<ThemeDefinition>;

  /**
   * Set the workbook's OOXML theme definition.
   * Writes to Rust via bridge — async. Triggers viewport palette invalidation
   * so subsequent renders pick up the new theme colors.
   */
  setWorkbookTheme(theme: ThemeDefinition): Promise<void>;

  /**
   * Get the current chrome theme (canvas UI shell colors).
   * Synchronous — TS-only, no Rust involvement.
   */
  getChromeTheme(): ChromeTheme;

  /**
   * Set chrome theme with partial merge semantics.
   * Merges the partial input with the **current** theme (not defaults).
   * Triggers canvas layer re-render and CSS variable update.
   *
   * To reset to defaults, pass `DEFAULT_CHROME_THEME` explicitly.
   */
  setChromeTheme(theme: Partial<ChromeTheme>): void;
}
