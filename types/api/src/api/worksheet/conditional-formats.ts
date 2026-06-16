/**
 * WorksheetConditionalFormatting — Sub-API for conditional formatting operations.
 *
 * Provides methods to add, update, remove, and query conditional formats
 * on a worksheet. Operates at the format level (not individual rules).
 */
import type { CellRange, CFRule, CFRuleInput, CFStyle, ConditionalFormat } from '../types';
import type { ConditionalFormatMutationReceipt } from '../mutation-receipt';

/** Update payload for a conditional format. */
export interface ConditionalFormatUpdate {
  /** Replace the rules array. */
  rules?: CFRule[];
  /** Replace the ranges this format applies to. */
  ranges?: CellRange[];
  /** Set stopIfTrue on all rules in this format. */
  stopIfTrue?: boolean;
}

/** Sub-API for conditional formatting operations on a worksheet. */
export interface WorksheetConditionalFormatting {
  /**
   * Add a formula-based conditional format for a range.
   *
   * This is the intent-level wrapper for the common case. It creates a single
   * formula rule and assigns IDs/priorities through the same path as {@link add}.
   * Formula strings may include the leading `=` or omit it.
   *
   * @param range - Cell range, or array of ranges, this format applies to
   * @param formula - Conditional-format formula (e.g. "=A1>100")
   * @param style - Style applied when the formula is true
   * @returns Receipt with the created conditional format, assigned IDs, and affected ranges
   */
  addFormula(
    range: string | CellRange | (string | CellRange)[],
    formula: string,
    style: CFStyle,
  ): Promise<ConditionalFormatMutationReceipt & ConditionalFormat>;

  /**
   * Add a new conditional format with ranges and rules.
   * The API assigns IDs and priorities — callers provide rule configuration only.
   *
   * @param ranges - Cell ranges this format applies to
   * @param rules - Rule inputs (without id/priority)
   * @returns Receipt with the created conditional format, assigned IDs, and affected ranges
   */
  add(
    ranges: (string | CellRange)[],
    rules: CFRuleInput[],
  ): Promise<ConditionalFormatMutationReceipt & ConditionalFormat>;

  /**
   * Get a conditional format by its ID.
   *
   * @param formatId - Format ID to look up
   * @returns The conditional format, or null if not found
   */
  get(formatId: string): Promise<ConditionalFormat | null>;

  /**
   * Check if a conditional format exists by ID.
   *
   * @param formatId - Format ID to check
   * @returns True if the format exists
   */
  has(formatId: string): Promise<boolean>;

  /**
   * Get the total number of conditional formats on this sheet.
   *
   * @returns The count of conditional formats
   */
  getCount(): Promise<number>;

  /**
   * Update an existing conditional format.
   * Supports replacing rules, ranges, and setting stopIfTrue on all rules.
   *
   * @param formatId - Format ID to update
   * @param updates - Object with optional rules, ranges, and stopIfTrue
   */
  update(
    formatId: string,
    updates: ConditionalFormatUpdate,
  ): Promise<ConditionalFormatMutationReceipt>;

  /**
   * Clear the style of a specific rule within a conditional format, resetting
   * all style properties (font, fill, border, number format) to unset.
   *
   * @param formatId - Format ID containing the rule
   * @param ruleId - Rule ID within the format to clear style for
   */
  clearRuleStyle(formatId: string, ruleId: string): Promise<ConditionalFormatMutationReceipt>;

  /**
   * Change the type and configuration of a specific rule within a conditional format,
   * preserving its ID and priority. This is the equivalent of eight
   * changeRuleTo*() methods, unified into one type-safe call using CFRuleInput.
   *
   * @param formatId - Format ID containing the rule
   * @param ruleId - Rule ID to change
   * @param newRule - New rule configuration (type + type-specific fields)
   */
  changeRuleType(
    formatId: string,
    ruleId: string,
    newRule: CFRuleInput,
  ): Promise<ConditionalFormatMutationReceipt>;

  /**
   * Get a conditional format by its index in the priority-ordered list.
   *
   * @param index - Zero-based index
   * @returns The conditional format at that index, or null if out of bounds
   */
  getItemAt(index: number): Promise<ConditionalFormat | null>;

  /**
   * Remove a conditional format by ID.
   *
   * @param formatId - Format ID to remove
   */
  remove(formatId: string): Promise<ConditionalFormatMutationReceipt>;

  /**
   * Remove a single rule from a conditional format. If the removed rule was
   * the last rule in the format, the conditional format itself is removed.
   *
   * @param formatId - Format ID containing the rule
   * @param ruleId - Rule ID to remove
   */
  removeRule(formatId: string, ruleId: string): Promise<ConditionalFormatMutationReceipt>;

  /**
   * Get all conditional formats on the sheet.
   *
   * @returns Array of conditional format objects
   */
  list(): Promise<ConditionalFormat[]>;

  /**
   * Clear all conditional formats from the sheet.
   */
  clear(): Promise<ConditionalFormatMutationReceipt>;

  /**
   * Clear conditional formats that intersect with the given ranges.
   *
   * @param ranges - Ranges to clear conditional formats from
   */
  clearInRanges(ranges: (string | CellRange)[]): Promise<ConditionalFormatMutationReceipt>;

  /**
   * Reorder conditional formats by format ID array (first = highest priority).
   *
   * @param formatIds - Array of format IDs in the desired order
   */
  reorder(formatIds: string[]): Promise<ConditionalFormatMutationReceipt>;

  /**
   * Clone conditional formats from source to target with offset.
   * Used by format painter and paste operations.
   *
   * @param sourceSheetId - Source sheet ID (for cut operation reference removal)
   * @param relativeCFs - Relative CF formats with range offsets
   * @param origin - Target paste origin (row, col)
   * @param isCut - Whether this is a cut operation
   */
  cloneForPaste(
    sourceSheetId: string,
    relativeCFs: Array<{
      rules: any[];
      rangeOffsets: Array<{
        startRowOffset: number;
        startColOffset: number;
        endRowOffset: number;
        endColOffset: number;
      }>;
    }>,
    origin: { row: number; col: number },
    isCut: boolean,
  ): Promise<ConditionalFormatMutationReceipt>;
}
