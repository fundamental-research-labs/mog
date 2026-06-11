/**
 * Clipboard Paste Integration
 *
 * Connects the clipboard state machine to the paste executor.
 * When the machine enters 'pasting' state, this coordination executes the paste
 * operation and sends PASTE_COMPLETE or PASTE_ERROR back to the machine.
 *
 * Extracted from cross-coordination.ts as part of coordinator decomposition.
 *
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';

import { EXTERNAL_SOURCE_SHEET_ID } from '@mog-sdk/contracts/actors';
import { sheetId as toSheetId, type CellRange, type SheetId } from '@mog-sdk/contracts/core';

import {
  createDefaultPasteOptions,
  executePasteIntoTargetRange,
  getClipboardDimensions,
  isFullShapeRange,
  isMatchingFullShapePaste,
  normalizeRange,
  type PasteStoreOperations,
} from '../../../domain/clipboard';
import type { clipboardMachine } from '../machines/clipboard-machine';
import { trackPendingClipboardPaste } from './pending-clipboard-paste';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type ClipboardActor = ActorRefFrom<typeof clipboardMachine>;
export type ClipboardState = SnapshotFrom<typeof clipboardMachine>;
type MaybePromise<T> = T | Promise<T>;

function hasAnyCellFormat(data: NonNullable<ClipboardState['context']['data']>): boolean {
  return Object.values(data.cells).some(
    (cell) => cell.format && Object.keys(cell.format as object).length > 0,
  );
}

async function clearSystemClipboardText(): Promise<void> {
  const writeText = globalThis.navigator?.clipboard?.writeText;
  if (typeof writeText !== 'function') return;
  try {
    await writeText.call(globalThis.navigator.clipboard, '');
  } catch {
    // Best effort only. Internal state still clears so cut/copy semantics hold.
  }
}

/**
 * Size dimensions for paste data or target selection.
 */
export interface PasteSize {
  rows: number;
  cols: number;
}

/**
 * Pending paste data for size mismatch dialog.
 */
export interface PendingPasteData {
  targetCell: { row: number; col: number };
  sheetId: SheetId;
  targetRange: CellRange;
}

/**
 * Protection check result.
 */
export interface ProtectionCheckResult {
  allowed: boolean;
  message?: string;
}

/**
 * Detailed protection info for partial protection handling.
 */
export interface RangeProtectionInfo {
  /** Whether the sheet has protection enabled */
  sheetProtected: boolean;
  /** Number of cells in the range that are protected (locked) */
  protectedCount: number;
  /** Number of cells in the range that are unprotected (unlocked) */
  unprotectedCount: number;
  /** Total number of cells in the range */
  totalCount: number;
  /** Set of protected cell keys in format "row,col" */
  protectedCells: Set<string>;
}

/**
 * Merge overlap check result.
 */
export interface MergeOverlapCheckResult {
  /** Whether any merges partially overlap with the target range */
  hasPartialOverlap: boolean;
  /** Number of merges that partially overlap */
  partialOverlapCount: number;
}

/**
 * Configuration for Clipboard-Paste integration.
 */
export interface ClipboardPasteIntegrationConfig {
  clipboardActor: ClipboardActor;
  /** Store operations for reading/writing cell data */
  store: PasteStoreOperations;
  /** Get current active sheet ID */
  getActiveSheetId: () => string;
  /** Get current selection range (for size mismatch check) */
  getSelectionRange?: () => CellRange | null;
  /**
   * Callback after paste completes (for render invalidation).
   * Enhanced to include cellCount for accessibility announcements.
   */
  onPasteComplete?: (affectedRange: CellRange, cellCount?: number) => void;
  /**
   * Selection After Paste
   * Callback to set selection to the pasted range.
   * Called after successful paste with the affected range.
   */
  updateSelectionAfterPaste?: (affectedRange: CellRange) => void;
  /**
   * Callback to clear source cells after cut-paste (
   * Called after successful paste when it was a cut operation.
   * The implementation should clear cell values in the source range.
   */
  onCutPasteComplete?: (sourceSheetId: SheetId, sourceRanges: CellRange[]) => void | Promise<void>;
  /**
   * Callback to show size mismatch dialog.
   * Called when clipboard size doesn't match selection size.
   */
  onSizeMismatch?: (
    sourceSize: PasteSize,
    targetSize: PasteSize,
    pendingData: PendingPasteData,
  ) => void;
  /**
   * Deprecated host callback retained for older dialog wiring.
   * Normal paste integration commits cut-paste overwrites directly.
   */
  onCutOverwriteConfirm?: (pendingData: {
    targetCell: { row: number; col: number };
    sheetId: SheetId;
    pasteOptions: ClipboardState['context']['pasteOptions'];
  }) => void;
  /**
   * Callback to check if paste is allowed on target range (Protection).
   * Returns whether paste is allowed and an optional error message.
   * @deprecated Use getProtectionInfo for partial protection support
   */
  checkProtection?: (sheetId: SheetId, range: CellRange) => MaybePromise<ProtectionCheckResult>;
  /**
   * Callback to get detailed protection info for a range.
   * Used to determine which cells can be pasted to and which are protected.
   */
  getProtectionInfo?: (sheetId: SheetId, range: CellRange) => MaybePromise<RangeProtectionInfo>;
  /**
   * Callback to show protection error dialog.
   * Called when paste is blocked due to protection.
   */
  onProtectionError?: (message: string) => void;
  /**
   * Callback to check if target range partially overlaps with merged cells.
   * Returns info about merges that partially overlap with the target range.
   */
  checkMergeOverlap?: (sheetId: SheetId, range: CellRange) => MergeOverlapCheckResult;
  /**
   * Callback to show merge overlap warning dialog.
   * Called when paste target partially overlaps with merged cells.
   */
  onMergeOverlapWarning?: (message: string) => void;
  /**
   * Callback to check if pasting formulas would create circular references.
   * Returns true if any pasted formula would create a circular reference.
   */
  checkCircularReference?: (
    sheetId: SheetId,
    targetRange: CellRange,
    formulas: Array<{ row: number; col: number; formula: string }>,
  ) => boolean;
  /**
   * Callback to show circular reference error.
   */
  onCircularReferenceError?: (message: string) => void;
  /**
   * Wrap a set of mutations in an undo group so they collapse into a single
   * undo step. Backed by `workbook.batch`.
   */
  batch?: <T>(fn: () => Promise<T>) => Promise<T>;

  /**
   * Async getter for the hidden-rows bitmap of a sheet.
   * When provided, paste-integration pre-fetches the bitmap just before
   * executePaste so that `store.isRowHidden` uses a fresh Set<number> and
   * filtered rows are correctly skipped (Excel parity,).
   * If omitted, hidden-row skipping is disabled (safe fallback).
   */
  getHiddenRows?: (sheetId: SheetId) => Promise<Set<number>>;
}

function getRangeSize(range: CellRange): PasteSize {
  const normalized = normalizeRange(range);
  return {
    rows: normalized.endRow - normalized.startRow + 1,
    cols: normalized.endCol - normalized.startCol + 1,
  };
}

function createSourceFootprintRange(
  targetCell: { row: number; col: number },
  sourceSize: PasteSize,
): CellRange {
  return {
    startRow: targetCell.row,
    startCol: targetCell.col,
    endRow: targetCell.row + sourceSize.rows - 1,
    endCol: targetCell.col + sourceSize.cols - 1,
  };
}

function selectionCanReceiveWholeTiles(sourceSize: PasteSize, targetSize: PasteSize): boolean {
  if (sourceSize.rows <= 0 || sourceSize.cols <= 0) return false;
  return targetSize.rows % sourceSize.rows === 0 && targetSize.cols % sourceSize.cols === 0;
}

// =============================================================================
// PASTE INTEGRATION IMPLEMENTATION
// =============================================================================

/**
 * Set up clipboard → paste executor integration.
 *
 * This connects the clipboard state machine to the paste executor.
 * When the machine enters 'pasting' state, the coordinator executes the paste
 * operation and sends PASTE_COMPLETE or PASTE_ERROR back to the machine.
 *
 * Flow:
 * 1. User triggers paste (PASTE or PASTE_SPECIAL event)
 * 2. Clipboard machine enters 'pasting' state with context containing:
 * - data: ClipboardData
 * - pastePreviewTarget: target cell
 * - pasteOptions: PasteSpecialOptions (if PASTE_SPECIAL)
 * 3. This integration detects 'pasting' state
 * 4. Executes the paste with the context data
 * 5. Sends PASTE_COMPLETE or PASTE_ERROR to complete the flow
 *
 */
export function setupClipboardPasteIntegration(
  config: ClipboardPasteIntegrationConfig,
): () => void {
  const {
    clipboardActor,
    store,
    getActiveSheetId,
    getSelectionRange,
    onPasteComplete,
    updateSelectionAfterPaste,
    onCutPasteComplete,
    onSizeMismatch,
    checkProtection,
    getProtectionInfo,
    onProtectionError,
    checkMergeOverlap,
    onMergeOverlapWarning,
    checkCircularReference,
    onCircularReferenceError,
    batch,
    getHiddenRows,
  } = config;
  let previousState: ClipboardState | null = null;

  const subscription = clipboardActor.subscribe((state) => {
    // Detect transition INTO pasting state
    const wasPasting = previousState?.matches('pasting') ?? false;
    const isPasting = state.matches('pasting');

    // Record the current snapshot before running side effects. `handlePaste`
    // may synchronously send machine events, and nested subscriptions must be
    // allowed to advance this value instead of being overwritten by a stale
    // `pasting` snapshot after the side effect returns.
    previousState = state;

    if (!wasPasting && isPasting) {
      const pending = handlePaste(state);
      trackPendingClipboardPaste(pending);
      void pending;
    }
  });

  async function handlePaste(state: ClipboardState): Promise<void> {
    const {
      data,
      pastePreviewTarget,
      pasteTargetRange,
      pasteOptions,
      isCut,
      sourceRanges,
      skipSizeCheck,
    } = state.context;

    // Must have clipboard data and a target cell
    if (!data || !pastePreviewTarget) {
      clipboardActor.send({ type: 'PASTE_ERROR', message: 'No clipboard data or target' });
      return;
    }

    const sheetId = toSheetId(getActiveSheetId());
    const options = pasteOptions ?? createDefaultPasteOptions();
    const formatsOnly =
      options.formats === true && !options.values && !options.formulas && !options.pasteLink;
    if (formatsOnly && data.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID && !hasAnyCellFormat(data)) {
      clipboardActor.send({ type: 'PASTE_COMPLETE' });
      return;
    }

    const clipboardSize = getClipboardDimensions(data);
    const capturedTargetRange = pasteTargetRange ? normalizeRange(pasteTargetRange) : null;
    let targetRange =
      capturedTargetRange ?? createSourceFootprintRange(pastePreviewTarget, clipboardSize);

    // Size mismatch check and target-range planning.
    // Multi-cell selections that can be filled by whole source tiles are carried
    // forward into paste execution. Other mismatches keep the existing dialog path.
    {
      const selectionRange = capturedTargetRange ?? getSelectionRange?.();
      if (selectionRange) {
        const normalizedSelection = normalizeRange(selectionRange);
        const targetSize = getRangeSize(normalizedSelection);

        // Only check mismatch for multi-cell selections
        const isMultiCellSelection = targetSize.rows > 1 || targetSize.cols > 1;
        const sizesMatch =
          clipboardSize.rows === targetSize.rows && clipboardSize.cols === targetSize.cols;
        const fullShapeIntentMatches = isMatchingFullShapePaste(
          data.sourceRanges,
          normalizedSelection,
        );
        const finiteRectangularSelection = !isFullShapeRange(normalizedSelection);
        const canFillSelectionWithTiles =
          finiteRectangularSelection && selectionCanReceiveWholeTiles(clipboardSize, targetSize);

        if (!isCut && isMultiCellSelection && canFillSelectionWithTiles) {
          targetRange = normalizedSelection;
        }

        // Handle special cases that don't need warnings
        // 1. Single cell source - can fill any selection (tiling)
        const isSingleCellSource = clipboardSize.rows === 1 && clipboardSize.cols === 1;
        // 2. Exact multiple - target is exact multiple of source (tiling)
        const isExactMultiple = selectionCanReceiveWholeTiles(clipboardSize, targetSize);

        // Show warning only for true mismatches (not exact multiples or single-cell sources)
        const needsWarning =
          !skipSizeCheck &&
          !!onSizeMismatch &&
          isMultiCellSelection &&
          !sizesMatch &&
          !fullShapeIntentMatches &&
          !isSingleCellSource &&
          !isExactMultiple;

        if (needsWarning) {
          // Cancel the paste and show dialog
          clipboardActor.send({ type: 'PASTE_ERROR', message: 'Size mismatch' });

          // Trigger dialog
          onSizeMismatch(clipboardSize, targetSize, {
            targetCell: pastePreviewTarget,
            sheetId,
            targetRange: normalizedSelection,
          });

          return;
        }
      }
    }

    // Track protected cells for partial paste
    let protectedCellsSet: Set<string> | undefined;
    const protectionBlockedMessage =
      'The cell or chart you are trying to change is on a protected sheet. ' +
      'To make a change, unprotect the sheet. You might be requested to enter a password.';

    // Use getProtectionInfo for partial protection if available, otherwise fall back to checkProtection
    if (getProtectionInfo) {
      const protectionInfo = await getProtectionInfo(sheetId, targetRange);

      if (protectionInfo.sheetProtected) {
        if (protectionInfo.protectedCount === protectionInfo.totalCount) {
          // ALL cells are protected - block entirely
          clipboardActor.send({
            type: 'PASTE_ERROR',
            message: protectionBlockedMessage,
          });
          onProtectionError?.(protectionBlockedMessage);
          return;
        } else if (isCut && protectionInfo.protectedCount > 0) {
          // Cut-paste must be atomic: partially moving cells and clearing the
          // full source range would lose data. Block instead of skipping.
          clipboardActor.send({
            type: 'PASTE_ERROR',
            message: protectionBlockedMessage,
          });
          onProtectionError?.(protectionBlockedMessage);
          return;
        } else if (protectionInfo.protectedCount > 0) {
          // SOME cells are protected - partial paste
          // Excel behavior: paste to unprotected cells only, skip protected ones
          protectedCellsSet = protectionInfo.protectedCells;
          // Note: We don't show an error dialog for partial paste - Excel just silently skips protected cells
        }
        // If protectedCount === 0, all cells are unprotected, proceed normally
      }
    } else if (checkProtection) {
      const protectionResult = await checkProtection(sheetId, targetRange);
      if (!protectionResult.allowed) {
        clipboardActor.send({
          type: 'PASTE_ERROR',
          message: protectionResult.message ?? 'Cannot paste to protected cells',
        });
        onProtectionError?.(protectionResult.message ?? 'Cannot paste to protected cells');
        return;
      }
    }

    // Merge overlap check
    // Check if paste target partially overlaps with merged cells
    // A partial overlap is when the paste range intersects a merge but doesn't fully contain it
    // Excel shows: "Cannot change part of a merged cell"
    if (checkMergeOverlap) {
      const mergeOverlapResult = checkMergeOverlap(sheetId, targetRange);
      if (mergeOverlapResult.hasPartialOverlap) {
        const message = 'Cannot change part of a merged cell.';
        clipboardActor.send({
          type: 'PASTE_ERROR',
          message,
        });
        onMergeOverlapWarning?.(message);
        return;
      }
    }

    // Circular reference detection
    // Check if pasting formulas would create circular references
    // Extract formulas from clipboard data and check for cycles
    if (checkCircularReference && data.cells) {
      const formulasToCheck: Array<{ row: number; col: number; formula: string }> = [];

      for (const [key, cellData] of Object.entries(data.cells)) {
        if (cellData.formula) {
          const [relRow, relCol] = key.split(',').map(Number);
          // Calculate absolute position in target range
          const targetRow = pastePreviewTarget.row + relRow;
          const targetCol = pastePreviewTarget.col + relCol;
          formulasToCheck.push({
            row: targetRow,
            col: targetCol,
            formula: cellData.formula,
          });
        }
      }

      if (formulasToCheck.length > 0) {
        const hasCircular = checkCircularReference(sheetId, targetRange, formulasToCheck);
        if (hasCircular) {
          const message =
            'There is a circular reference. A circular reference is when a formula refers to its own cell, either directly or indirectly.';
          clipboardActor.send({
            type: 'PASTE_ERROR',
            message,
          });
          onCircularReferenceError?.(message);
          return;
        }
      }
    }

    // TODO: Verify merged regions relocate correctly during paste operations

    // Wrap all mutations in an undo group so the entire paste is one undo step.
    const executeMutations = async () => {
      // Cut-paste uses cell relocation to preserve CellIds (so formulas
      // referencing the moved cells continue to resolve). Copy-paste uses
      // executePaste, which creates new CellIds (formula refs to the
      // source range stay pointed at the source).
      //
      // same-sheet cut-paste now uses store.relocateCells
      // too. The Rust `relocate_cells_yrs` mutation handler emits
      // clear-patches for vacated source cells AND write-patches for
      // every target position. The previous
      // `&& isCrossSheet` gate that fell back to executePaste — silently
      // breaking formula-reference integrity — is gone.
      if (
        isCut &&
        sourceRanges &&
        sourceRanges.length > 0 &&
        data.sourceSheetId &&
        store.relocateCells &&
        pasteOptions == null &&
        !protectedCellsSet
      ) {
        // Cut-paste: Use cell relocation to preserve CellIds
        // This is architecturally correct - formulas referencing moved cells automatically work
        const sourceRange = sourceRanges[0]; // Currently only single-range cut supported
        const result = await store.relocateCells(
          toSheetId(data.sourceSheetId),
          sourceRange,
          sheetId,
          pastePreviewTarget.row,
          pastePreviewTarget.col,
        );

        if (result.success) {
          await store.moveTablesForCutPaste?.(
            toSheetId(data.sourceSheetId),
            sourceRange,
            sheetId,
            pastePreviewTarget.row,
            pastePreviewTarget.col,
          );
          await store.movePivotsForCutPaste?.(
            toSheetId(data.sourceSheetId),
            sourceRange,
            sheetId,
            pastePreviewTarget.row,
            pastePreviewTarget.col,
          );
          await clearSystemClipboardText();
          clipboardActor.send({ type: 'PASTE_COMPLETE' });

          // Calculate affected range for render invalidation
          const affectedRange: CellRange = {
            startRow: pastePreviewTarget.row,
            startCol: pastePreviewTarget.col,
            endRow: pastePreviewTarget.row + (sourceRange.endRow - sourceRange.startRow),
            endCol: pastePreviewTarget.col + (sourceRange.endCol - sourceRange.startCol),
          };
          // Calculate cell count for accessibility
          const cellCount =
            (sourceRange.endRow - sourceRange.startRow + 1) *
            (sourceRange.endCol - sourceRange.startCol + 1);
          onPasteComplete?.(affectedRange, cellCount);
          // Selection After Paste - set selection to pasted range
          updateSelectionAfterPaste?.(affectedRange);
        } else {
          clipboardActor.send({
            type: 'PASTE_ERROR',
            message: result.error ?? 'Relocation failed',
          });
        }
      } else {
        // Copy-paste (or cut-paste fallback): Use executePaste to create new CellIds
        // Include skipCells for partial protection handling
        const executionOptions = {
          ...options,
          ...(protectedCellsSet ? { skipCells: protectedCellsSet } : {}),
        };

        // Pre-fetch hidden-rows bitmap so paste skips filtered rows
        // (Excel parity). getHiddenRows is async; augment the store with a
        // fresh synchronous checker right before executePaste is called.
        let effectiveStore = store;
        if (getHiddenRows) {
          const hiddenRows = await getHiddenRows(sheetId);
          if (hiddenRows.size > 0) {
            effectiveStore = { ...store, isRowHidden: (_sid, row) => hiddenRows.has(row) };
          }
        }

        const result = await executePasteIntoTargetRange(
          data,
          pastePreviewTarget,
          sheetId,
          executionOptions,
          effectiveStore,
          targetRange,
          capturedTargetRange !== null,
        );

        if (result.success) {
          if (isCut && sourceRanges && sourceRanges.length > 0 && data.sourceSheetId) {
            for (const sourceRange of sourceRanges) {
              await store.moveTablesForCutPaste?.(
                toSheetId(data.sourceSheetId),
                sourceRange,
                sheetId,
                pastePreviewTarget.row,
                pastePreviewTarget.col,
              );
              await store.movePivotsForCutPaste?.(
                toSheetId(data.sourceSheetId),
                sourceRange,
                sheetId,
                pastePreviewTarget.row,
                pastePreviewTarget.col,
              );
            }

            // Unmerge merges in source ranges
            if (store.getMergesInRange && store.unmergeRange) {
              for (const sourceRange of sourceRanges) {
                const sourceMerges = store.getMergesInRange(
                  toSheetId(data.sourceSheetId),
                  sourceRange,
                );
                for (const merge of sourceMerges) {
                  store.unmergeRange(
                    toSheetId(data.sourceSheetId),
                    merge.startRow,
                    merge.startCol,
                    merge.endRow,
                    merge.endCol,
                  );
                }
              }
            }

            // Callback for clearing source cell values — must await so the
            // source-clear mutation lands in the surrounding undo group.
            await onCutPasteComplete?.(toSheetId(data.sourceSheetId), sourceRanges);
            await clearSystemClipboardText();
          }

          clipboardActor.send({ type: 'PASTE_COMPLETE' });
          // Pass cell count for accessibility announcements
          onPasteComplete?.(result.affectedRange, result.cellCount);
          // Selection After Paste - set selection to pasted range
          updateSelectionAfterPaste?.(result.affectedRange);
        } else {
          clipboardActor.send({ type: 'PASTE_ERROR', message: result.error ?? 'Paste failed' });
        }
      }
    };

    try {
      if (batch) {
        await batch(executeMutations);
      } else {
        await executeMutations();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown paste error';
      clipboardActor.send({ type: 'PASTE_ERROR', message });
    }
  }

  return () => subscription.unsubscribe();
}
