/**
 * Format Painter Action Handlers
 *
 * Pure handler functions for format painter actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload) => ActionResult
 * - Format painter state is managed in UIStore (format-painter slice)
 * - APPLY_FORMAT_PAINTER writes format via Worksheet API
 *
 * This file handles:
 * - START_FORMAT_PAINTER: Starts format painter mode with source format/range
 * - STOP_FORMAT_PAINTER: Exits format painter mode
 * - LOCK_FORMAT_PAINTER: Locks format painter (double-click behavior)
 * - APPLY_FORMAT_PAINTER: Applies format to target range with pattern replication
 *
 * Format Painter
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { ValidationRule } from '@mog-sdk/contracts/api';
import type { CellFormat, CellRange } from '@mog-sdk/contracts/core';
import { colToLetter, parseA1Range } from '@mog/spreadsheet-utils/a1';

import type { ConditionalFormat as ConditionalFormatType } from '@mog-sdk/contracts/conditional-format';

import { getUIStore, handled } from './handler-utils';

// =============================================================================
// Handlers
// =============================================================================

/**
 * START_FORMAT_PAINTER
 *
 * Starts format painter mode with the current selection's format.
 * The format painter will copy formatting from the source range
 * and apply it to cells that are clicked.
 *
 * Captures source sheet ID for cross-sheet format painting.
 * Also captures conditional formatting rules that apply to the source range.
 * Also captures validation schemas that apply to the source range.
 *
 * @param deps - Action dependencies
 * @param payload - Source format, range, sheet ID, optional CF rules, and optional validation schemas to copy from
 */
export const START_FORMAT_PAINTER: ActionHandler = (
  deps: ActionDependencies,
  payload?: {
    format: CellFormat;
    range: CellRange;
    sheetId?: string;
    conditionalFormats?: ConditionalFormatType[];
    validationSchemas?: ValidationRule[];
  },
): ActionResult => {
  if (!payload) {
    return { handled: false, reason: 'disabled', error: 'No format/range provided' };
  }

  const uiStore = getUIStore(deps);
  // Use provided sheetId or fall back to active sheet
  const sourceSheetId = payload.sheetId ?? deps.getActiveSheetId();
  uiStore
    .getState()
    .startFormatPainter(
      payload.format,
      payload.range,
      sourceSheetId,
      payload.conditionalFormats,
      payload.validationSchemas,
    );
  return handled();
};

/**
 * STOP_FORMAT_PAINTER
 *
 * Exits format painter mode, clearing the stored format.
 */
export const STOP_FORMAT_PAINTER: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().stopFormatPainter();
  return handled();
};

/**
 * LOCK_FORMAT_PAINTER
 *
 * Locks format painter mode (double-click behavior).
 * When locked, format painter stays active after applying format
 * until ESC is pressed.
 */
export const LOCK_FORMAT_PAINTER: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().lockFormatPainter();
  return handled();
};

// =============================================================================
// Insert ribbon dispatch: Toggle/Double-click variants
//
// These handlers consolidate the orchestration logic that previously lived
// in `chrome/toolbar/hooks/use-clipboard-actions.ts`. They are the single
// source of truth for the ribbon "Format Painter" button (single-click
// toggle and double-click lock).
// =============================================================================

/**
 * Resolve the source range + format + validation schemas for a format-painter
 * activation. Reads the current selection on-demand and queries the active
 * worksheet for matching validation rules.
 */
async function resolveFormatPainterActivation(deps: ActionDependencies): Promise<{
  format: CellFormat;
  range: CellRange;
  sheetId: string;
  validationSchemas?: ValidationRule[];
}> {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const ranges = deps.accessors.selection.getRanges();
  const activeCell = deps.accessors.selection.getActiveCell();

  // Source range: first selection range, or single-cell range from active cell
  const sourceRange: CellRange =
    ranges && ranges.length > 0
      ? (ranges[0] as CellRange)
      : {
          startRow: activeCell.row,
          startCol: activeCell.col,
          endRow: activeCell.row,
          endCol: activeCell.col,
        };

  // Source format: the active cell's current format (sync read via viewport)
  const currentFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format;

  // Capture validation schemas overlapping the source range
  let validationSchemas: ValidationRule[] | undefined;
  try {
    const allRules = await ws.validations.list();
    const overlapping = allRules.filter((rule) => {
      if (!rule.range) return false;
      const parsed = parseA1Range(rule.range);
      return (
        parsed.startRow <= sourceRange.endRow &&
        parsed.endRow >= sourceRange.startRow &&
        parsed.startCol <= sourceRange.endCol &&
        parsed.endCol >= sourceRange.startCol
      );
    });
    if (overlapping.length > 0) {
      validationSchemas = overlapping;
    }
  } catch {
    // Validation list failures are non-fatal — fall through with no schemas.
  }

  return {
    format: currentFormat ?? {},
    range: sourceRange,
    sheetId,
    validationSchemas,
  };
}

/**
 * TOGGLE_FORMAT_PAINTER
 *
 * Single-click toolbar entry point. If format painter is currently active,
 * deactivates it; otherwise reads the current selection + format and
 * activates with that source.
 *
 * Two-phase activation: the format and range are resolved synchronously from
 * the viewport cache so the UI activates immediately (before the next rAF),
 * then validation schemas are loaded asynchronously and merged in. This
 * guarantees the format-painter button is visually active before settle()
 * returns in keytip-chord test scenarios.
 */
export const TOGGLE_FORMAT_PAINTER: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const isActive = uiStore.getState().formatPainter.isActive;

  if (isActive) {
    uiStore.getState().stopFormatPainter();
    return handled();
  }

  // synchronous. Activate immediately using viewport-cached format
  // data so the button reflects the active state before the next animation
  // frame (validation schema loading is async and can take >1 rAF).
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const ranges = deps.accessors.selection.getRanges();
  const activeCell = deps.accessors.selection.getActiveCell();
  const sourceRange: CellRange =
    ranges && ranges.length > 0
      ? (ranges[0] as CellRange)
      : {
          startRow: activeCell.row,
          startCol: activeCell.col,
          endRow: activeCell.row,
          endCol: activeCell.col,
        };
  const currentFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format ?? {};
  uiStore.getState().startFormatPainter(currentFormat, sourceRange, sheetId, undefined, undefined);

  // async. Load validation schemas and update state if format
  // painter is still active (user may have cancelled before schemas load).
  void (async () => {
    try {
      const allRules = await ws.validations.list();
      const overlapping = allRules.filter((rule) => {
        if (!rule.range) return false;
        const parsed = parseA1Range(rule.range);
        return (
          parsed.startRow <= sourceRange.endRow &&
          parsed.endRow >= sourceRange.startRow &&
          parsed.startCol <= sourceRange.endCol &&
          parsed.endCol >= sourceRange.startCol
        );
      });
      if (overlapping.length > 0 && uiStore.getState().formatPainter.isActive) {
        uiStore
          .getState()
          .startFormatPainter(currentFormat, sourceRange, sheetId, undefined, overlapping);
      }
    } catch {
      // Validation load failure is non-fatal — format painter stays active
      // without schema replication support.
    }
  })();

  return handled();
};

/**
 * TOGGLE_FORMAT_PAINTER_LOCKED
 *
 * Double-click toolbar entry point. If format painter is inactive, activate
 * it from the current selection. Then lock it (stay-on-after-apply).
 */
export const TOGGLE_FORMAT_PAINTER_LOCKED: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const isActive = uiStore.getState().formatPainter.isActive;

  if (!isActive) {
    const { format, range, sheetId, validationSchemas } =
      await resolveFormatPainterActivation(deps);
    uiStore.getState().startFormatPainter(format, range, sheetId, undefined, validationSchemas);
  }

  uiStore.getState().lockFormatPainter();
  return handled();
};

/**
 * APPLY_FORMAT_PAINTER
 *
 * Applies the stored format to the target range.
 * Implements pattern replication: when destination is larger than source,
 * the source format pattern is tiled to fill the destination.
 *
 * Supports cross-sheet format painting.
 * Also applies conditional formatting rules from the source range.
 * Also applies validation schemas from the source range.
 *
 * Format and CF writes migrated to Worksheet API.
 * - applyFormatToRange → ws.formats.applyPattern()
 * - CFMutations.cloneConditionalFormatsForPaste → ws.conditionalFormats.cloneForPaste()
 * - Schemas operations migrated to ws.validations.set() (Worksheet API).
 *
 * After applying:
 * - If locked: stays in format painter mode
 * - If not locked: exits format painter mode
 *
 * @param deps - Action dependencies
 * @param payload - Target range to apply format to
 */
export const APPLY_FORMAT_PAINTER: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { targetRange: CellRange },
): Promise<ActionResult> => {
  if (!payload) {
    return { handled: false, reason: 'disabled', error: 'No target range provided' };
  }

  const uiStore = getUIStore(deps);
  const targetSheetId = deps.getActiveSheetId();
  const formatPainterState = uiStore.getState().formatPainter;

  // Check if format painter is active
  if (
    !formatPainterState.isActive ||
    !formatPainterState.sourceFormat ||
    !formatPainterState.sourceRange
  ) {
    return { handled: false, reason: 'disabled', error: 'Format painter not active' };
  }

  const {
    sourceFormat,
    sourceRange,
    sourceSheetId,
    sourceConditionalFormats,
    sourceValidationSchemas,
    isLocked,
  } = formatPainterState;
  const { targetRange } = payload;

  await deps.workbook.undoGroup(async () => {
    deps.workbook.setPendingUndoDescription('Apply Format Painter');

    // Get Worksheet API handle for target sheet
    const ws = deps.workbook.getSheetById(targetSheetId);

    // Apply format with pattern replication via Worksheet API
    await ws.formats.applyPattern(sourceFormat, sourceRange, targetRange);

    // Apply conditional formatting rules
    // Clone CF rules from source to target location (supports cross-sheet)
    if (sourceConditionalFormats && sourceConditionalFormats.length > 0) {
      // Calculate offset from source to target
      const rowOffset = targetRange.startRow - sourceRange.startRow;
      const colOffset = targetRange.startCol - sourceRange.startCol;

      // Convert to relative CF format for cloning
      const relativeCFs = sourceConditionalFormats.map((cf) => ({
        rules: cf.rules,
        rangeOffsets: (cf.ranges ?? []).map((r: any) => ({
          startRowOffset: r.startRow - sourceRange.startRow + rowOffset,
          startColOffset: r.startCol - sourceRange.startCol + colOffset,
          endRowOffset: r.endRow - sourceRange.startRow + rowOffset,
          endColOffset: r.endCol - sourceRange.startCol + colOffset,
        })),
      }));

      // Clone CF rules to target location via Worksheet API
      await ws.conditionalFormats.cloneForPaste(
        sourceSheetId ?? targetSheetId,
        relativeCFs,
        { row: sourceRange.startRow, col: sourceRange.startCol },
        false, // Not a cut operation
      );
    }

    // Apply validation schemas
    // Clone validation rules from source to target location via Worksheet API
    if (sourceValidationSchemas && sourceValidationSchemas.length > 0) {
      const targetAddress = `${colToLetter(targetRange.startCol)}${targetRange.startRow + 1}:${colToLetter(targetRange.endCol)}${targetRange.endRow + 1}`;
      for (const sourceRule of sourceValidationSchemas) {
        // Create a copy without the id and range (so a new schema is created, not updating the source)
        const { id: _id, range: _range, ...ruleCopy } = sourceRule;
        await ws.validations.set(targetAddress, ruleCopy as ValidationRule);
      }
    }
  });

  // If not locked, exit format painter mode
  if (!isLocked) {
    uiStore.getState().stopFormatPainter();
  }

  return handled();
};
