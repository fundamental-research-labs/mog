/**
 * Clipboard Hook
 *
 * Complete clipboard operations hook that wraps the XState clipboard machine
 * and provides convenient methods for copy/cut/paste operations.
 *
 * This is the SINGLE clipboard hook - all clipboard operations go through here.
 * The hook handles:
 * - XState machine state and events
 * - Building clipboard data from current selection
 * - Writing to system clipboard (for cross-app paste)
 * - Convenience methods (copySelection, cutSelection, pasteToSelection)
 *
 * All domain module reads go through the unified Worksheet API with proper async
 * pre-fetching. Browser clipboard events use navigator.clipboard.write() (modern async
 * API) instead of event.clipboardData.setData() (legacy sync API). Zero `as any` casts.
 *
 * ARCHITECTURE: Uses selectors from contracts for reactive reads and commands for writes.
 * @see docs/renderer/README.md - Clipboard Machine
 */

import { useSelector } from '@xstate/react';
import { useCallback, useMemo } from 'react';

import {
  unifiedCopy,
  unifiedCut,
  unifiedPaste,
  type UnifiedCopyCutDeps,
} from '../../domain/clipboard';

import {
  type ClipboardData,
  type ExternalPastePayload,
  type PasteSpecialOptions,
} from '@mog-sdk/contracts/actors';
import { clipboardSelectors } from '../../selectors';
import type { ClipboardState } from '@mog-sdk/contracts/actors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { ClipboardSnapshot } from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { blobToDataUrl } from '../../utils/blob-to-data-url';
import { withHandlerErrors } from '../../devtools/handler-error-boundary';
import { useActiveSheetId, useReadOnly, useWorkbook } from '../../infra/context';
import { waitForPendingClipboardPaste } from '../../systems/grid-editing/coordination/pending-clipboard-paste';
import { useCoordinator } from '../shared/use-coordinator';
import { prefetchClipboardData } from './clipboard-prefetch';

// =============================================================================
// SELECTOR STATE SLICE
// =============================================================================

/**
 * State slice for clipboard selector - extracts only the fields needed for rendering.
 * This prevents re-renders when unrelated clipboard state changes.
 */
interface ClipboardStateSlice {
  // For getClipboardSnapshot()
  hasCopyAvailable: boolean;
  hasCut: boolean;
  cutSource: CellRange[] | null;
  copySource: CellRange[] | null;
  isPasting: boolean;
  /** Source sheet ID for sheet-scoped marching ants */
  sourceSheetId: string | null;
  // Additional fields used directly in hook return
  isPastePreview: boolean;
  marchingAntsPhase: number;
  errorMessage: string | null;
  pastePreviewTarget: CellCoord | null;
}

// =============================================================================
// EQUALITY FUNCTION
// =============================================================================

/**
 * Compare two CellRange arrays for equality.
 */
function rangesEqual(a: CellRange[] | null, b: CellRange[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  return a.every(
    (range, i) =>
      range.startRow === b[i].startRow &&
      range.startCol === b[i].startCol &&
      range.endRow === b[i].endRow &&
      range.endCol === b[i].endCol,
  );
}

/**
 * Compare two CellCoord values for equality.
 */
function coordEqual(a: CellCoord | null, b: CellCoord | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.row === b.row && a.col === b.col;
}

/**
 * Custom equality function for clipboard state comparison.
 * Only returns true (preventing re-render) if all tracked fields are identical.
 */
function clipboardStateEqual(a: ClipboardStateSlice, b: ClipboardStateSlice): boolean {
  return (
    a.hasCopyAvailable === b.hasCopyAvailable &&
    a.hasCut === b.hasCut &&
    a.isPasting === b.isPasting &&
    a.isPastePreview === b.isPastePreview &&
    a.marchingAntsPhase === b.marchingAntsPhase &&
    a.errorMessage === b.errorMessage &&
    a.sourceSheetId === b.sourceSheetId &&
    rangesEqual(a.cutSource, b.cutSource) &&
    rangesEqual(a.copySource, b.copySource) &&
    coordEqual(a.pastePreviewTarget, b.pastePreviewTarget)
  );
}

function cloneRange(range: CellRange | null | undefined): CellRange | null {
  if (!range) return null;
  return {
    startRow: range.startRow,
    startCol: range.startCol,
    endRow: range.endRow,
    endCol: range.endCol,
  };
}

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseClipboardReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Whether clipboard has copy data */
  hasCopy: boolean;

  /** Whether clipboard has cut data (shows marching ants) */
  hasCut: boolean;

  /** Whether clipboard has data (either copy or cut) */
  hasClipboard: boolean;

  /** Whether clipboard is empty */
  isEmpty: boolean;

  /** Whether currently pasting */
  isPasting: boolean;

  /** Whether showing paste preview */
  isShowingPreview: boolean;

  /** Source ranges for cut operation (for marching ants rendering) */
  cutSource: CellRange[] | null;

  /** Current marching ants animation phase (0-7) */
  marchingAntsPhase: number;

  /** Error message from failed paste */
  errorMessage: string | null;

  /** Paste preview target cell */
  pastePreviewTarget: CellCoord | null;

  /** Full snapshot for advanced usage */
  snapshot: ClipboardSnapshot;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS (use current selection)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Copy the current selection to clipboard (async: pre-fetches data, writes to system clipboard) */
  copySelection: () => Promise<void>;

  /** Cut the current selection to clipboard (async: pre-fetches data, writes to system clipboard) */
  cutSelection: () => Promise<void>;

  /**
   * Paste clipboard data at the current active cell.
   * Returns a Promise because it reads the system clipboard to detect external copies.
   */
  pasteToSelection: () => Promise<void>;

  /**
   * Paste values only at the current active cell.
   * Returns a Promise because it reads the system clipboard to detect external copies.
   */
  pasteValues: () => Promise<void>;

  /**
   * Paste formulas only at the current active cell.
   * Returns a Promise because it reads the system clipboard to detect external copies.
   */
  pasteFormulas: () => Promise<void>;

  /**
   * Paste formats only at the current active cell.
   * Returns a Promise because it reads the system clipboard to detect external copies.
   */
  pasteFormats: () => Promise<void>;

  // ═══════════════════════════════════════════════════════════════════════════
  // LOW-LEVEL ACTIONS (explicit ranges/data)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Copy the given ranges with explicit data */
  copy: (ranges: CellRange[], data: ClipboardData) => void;

  /** Cut the given ranges with explicit data */
  cut: (ranges: CellRange[], data: ClipboardData) => void;

  /** Clear clipboard */
  clear: () => void;

  /** Paste at explicit target cell */
  paste: (targetCell: CellCoord) => void;

  /** Paste special with options at explicit target cell */
  pasteSpecial: (targetCell: CellCoord, options: PasteSpecialOptions) => void;

  /** Paste from external source (text/html from other apps) */
  pasteExternal: (payload: ExternalPastePayload) => void;

  /** Show paste preview at target */
  showPastePreview: (targetCell: CellCoord) => void;

  /** Hide paste preview */
  hidePastePreview: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIMATION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Tick the marching ants animation (call in requestAnimationFrame) */
  tickMarchingAnts: () => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for clipboard operations.
 *
 * Provides both convenience methods (copySelection, cutSelection, pasteToSelection)
 * and low-level methods (copy, cut, paste) for advanced use cases.
 *
 * @example
 * ```tsx
 * function ClipboardButtons() {
 * const { copySelection, cutSelection, pasteToSelection, hasClipboard } = useClipboard;
 *
 * return (
 * <>
 * <button onClick={copySelection}>Copy</button>
 * <button onClick={cutSelection}>Cut</button>
 * <button onClick={pasteToSelection} disabled={!hasClipboard}>Paste</button>
 * </>
 * );
 * }
 * ```
 */
export function useClipboard(): UseClipboardReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.clipboard;
  // Performance: NO selection subscriptions here - clipboard callbacks read on-demand
  // via coordinator.grid.getSelectionSnapshot() when invoked. This prevents re-renders
  // during high-frequency selection changes (60Hz during drag).
  // @see Architecture Section 15: Remove high-frequency subscriptions from low-frequency UI
  // @see Architecture Section 18: Handlers use point-in-time reads, not reactive subscriptions
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const readOnly = useReadOnly();

  // Get pre-created commands from the grid system (stable references)
  const commands = coordinator.grid.access.commands.clipboard;

  // Subscribe to ONLY the fields we need with custom equality
  // This prevents re-renders when unrelated clipboard state changes
  // (e.g., internal state transitions that don't affect rendered output)
  const stateSlice = useSelector(
    actor,
    (state): ClipboardStateSlice => ({
      hasCopyAvailable: clipboardSelectors.hasCopyAvailable(state as ClipboardState),
      hasCut: clipboardSelectors.hasCut(state as ClipboardState),
      cutSource: clipboardSelectors.cutSource(state as ClipboardState),
      copySource: clipboardSelectors.copySource(state as ClipboardState),
      isPasting: clipboardSelectors.isPasting(state as ClipboardState),
      sourceSheetId: clipboardSelectors.sourceSheetId(state as ClipboardState),
      isPastePreview: clipboardSelectors.isPastePreview(state as ClipboardState),
      marchingAntsPhase: clipboardSelectors.marchingAntsPhase(state as ClipboardState),
      errorMessage: clipboardSelectors.errorMessage(state as ClipboardState),
      pastePreviewTarget: clipboardSelectors.pastePreviewTarget(state as ClipboardState),
    }),
    clipboardStateEqual,
  );

  // Derive snapshot from the state slice (no longer needs full state)
  const snapshot: ClipboardSnapshot = useMemo(
    () => ({
      hasCopy: stateSlice.hasCopyAvailable,
      hasCut: stateSlice.hasCut,
      cutSource: stateSlice.cutSource,
      copySource: stateSlice.copySource,
      isPasting: stateSlice.isPasting,
      sourceSheetId: stateSlice.sourceSheetId,
    }),
    [stateSlice],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // LOW-LEVEL ACTIONS (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

  const copy = useMemo(
    () => (ranges: CellRange[], data: ClipboardData) => {
      commands.copy(ranges, data);
    },
    [commands],
  );

  const cut = useMemo(
    () => (ranges: CellRange[], data: ClipboardData) => {
      commands.cut(ranges, data);
    },
    [commands],
  );

  const clear = useMemo(
    () => () => {
      commands.clear();
    },
    [commands],
  );

  const paste = useMemo(
    () => (targetCell: CellCoord) => {
      commands.paste(targetCell);
    },
    [commands],
  );

  const pasteSpecial = useMemo(
    () => (targetCell: CellCoord, options: PasteSpecialOptions) => {
      commands.pasteSpecial(targetCell, options);
    },
    [commands],
  );

  const pasteExternal = useMemo(
    () => (payload: ExternalPastePayload) => {
      commands.externalPaste(payload);
    },
    [commands],
  );

  const showPastePreview = useMemo(
    () => (targetCell: CellCoord) => {
      commands.showPastePreview(targetCell);
    },
    [commands],
  );

  const hidePastePreview = useMemo(
    () => () => {
      commands.hidePastePreview();
    },
    [commands],
  );

  const tickMarchingAnts = useMemo(
    () => () => {
      commands.tickMarchingAnts();
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS (use commands instead of actor.send)
  // ═══════════════════════════════════════════════════════════════════════════

  const copySelection = useCallback(async () => {
    // / O-A: surface fire-and-forget rejections in __dt.recentErrors
    // tagged 'handler:COPY' instead of dying silent at the React boundary.
    return withHandlerErrors('COPY', async () => {
      // On-demand read: Get selection state only when the copy action is invoked
      const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
      const ranges = selectionSnapshot.ranges;
      if (!ranges || ranges.length === 0) return;

      const mutableRanges = [...ranges] as CellRange[];
      // Pre-fetch all data via ONE API — proper async, zero casts
      const prefetched = await prefetchClipboardData(wb, activeSheetId, ranges);

      const deps: UnifiedCopyCutDeps = {
        commands,
        buildData: prefetched.buildData,
        generateTSV: prefetched.generateTSV,
        generateHTML: prefetched.generateHTML,
      };

      await unifiedCopy(mutableRanges, deps);
    });
  }, [coordinator, activeSheetId, wb, commands]);

  const cutSelection = useCallback(async () => {
    if (readOnly) return; // Read-only mode: block cut
    // / O-A: surface fire-and-forget rejections in __dt.recentErrors
    // tagged 'handler:CUT'.
    return withHandlerErrors('CUT', async () => {
      // On-demand read: Get selection state only when the cut action is invoked
      const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
      const ranges = selectionSnapshot.ranges;
      if (!ranges || ranges.length === 0) return;

      const mutableRanges = [...ranges] as CellRange[];
      // Pre-fetch all data via ONE API — proper async, zero casts
      const prefetched = await prefetchClipboardData(wb, activeSheetId, ranges);

      const deps: UnifiedCopyCutDeps = {
        commands,
        buildData: prefetched.buildData,
        generateTSV: prefetched.generateTSV,
        generateHTML: prefetched.generateHTML,
      };

      await unifiedCut(mutableRanges, deps);
    });
  }, [coordinator, activeSheetId, wb, commands, readOnly]);

  // Paste callbacks use unified paste logic that reads the system clipboard
  // to detect external copies. This ensures consistent behavior across all paste methods.

  const pasteToSelection = useCallback(async (): Promise<void> => {
    if (readOnly) return; // Read-only mode: block paste
    // / O-A: surface fire-and-forget rejections (e.g. compute bridge
    // throws inside `unifiedPaste`) in __dt.recentErrors as 'handler:PASTE'.
    return withHandlerErrors('PASTE', async () => {
      const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
      const activeCell = selectionSnapshot.activeCell;
      const targetRange = cloneRange(selectionSnapshot.ranges[0]);
      await unifiedPaste(activeCell, {
        getClipboardSnapshot: () => actor.getSnapshot() as ClipboardState,
        commands,
        getTargetRange: () => targetRange,
        waitForPasteCommit: waitForPendingClipboardPaste,
        pasteImage: async (blob, anchorCell) => {
          const ws = wb.getSheetById(activeSheetId);
          const dataUrl = await blobToDataUrl(blob);
          await ws.pictures.add({
            src: dataUrl,
            anchorCell: { row: anchorCell.row, col: anchorCell.col },
          });
        },
      });
    });
  }, [coordinator, actor, commands, readOnly, wb, activeSheetId]);

  const pasteValues = useCallback(async (): Promise<void> => {
    if (readOnly) return; // Read-only mode: block paste
    return withHandlerErrors('PASTE_VALUES', async () => {
      const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
      const activeCell = selectionSnapshot.activeCell;
      const targetRange = cloneRange(selectionSnapshot.ranges[0]);
      await unifiedPaste(
        activeCell,
        {
          getClipboardSnapshot: () => actor.getSnapshot() as ClipboardState,
          commands,
          getTargetRange: () => targetRange,
          waitForPasteCommit: waitForPendingClipboardPaste,
        },
        { values: true },
      );
    });
  }, [coordinator, actor, commands, readOnly]);

  const pasteFormulas = useCallback(async (): Promise<void> => {
    if (readOnly) return; // Read-only mode: block paste
    return withHandlerErrors('PASTE_FORMULAS', async () => {
      const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
      const activeCell = selectionSnapshot.activeCell;
      const targetRange = cloneRange(selectionSnapshot.ranges[0]);
      await unifiedPaste(
        activeCell,
        {
          getClipboardSnapshot: () => actor.getSnapshot() as ClipboardState,
          commands,
          getTargetRange: () => targetRange,
          waitForPasteCommit: waitForPendingClipboardPaste,
        },
        { formulas: true },
      );
    });
  }, [coordinator, actor, commands, readOnly]);

  const pasteFormats = useCallback(async (): Promise<void> => {
    if (readOnly) return; // Read-only mode: block paste
    return withHandlerErrors('PASTE_FORMATTING', async () => {
      const selectionSnapshot = coordinator.grid.getSelectionSnapshot();
      const activeCell = selectionSnapshot.activeCell;
      const targetRange = cloneRange(selectionSnapshot.ranges[0]);
      await unifiedPaste(
        activeCell,
        {
          getClipboardSnapshot: () => actor.getSnapshot() as ClipboardState,
          commands,
          getTargetRange: () => targetRange,
          waitForPasteCommit: waitForPendingClipboardPaste,
        },
        { formats: true },
      );
    });
  }, [coordinator, actor, commands, readOnly]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE (using stateSlice instead of full state)
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State - using stateSlice (already extracted via granular selector)
      hasCopy: snapshot.hasCopy,
      hasCut: snapshot.hasCut,
      hasClipboard: snapshot.hasCopy || snapshot.hasCut,
      isEmpty: !snapshot.hasCopy && !snapshot.hasCut,
      isPasting: snapshot.isPasting,
      isShowingPreview: stateSlice.isPastePreview,
      cutSource: snapshot.cutSource,
      marchingAntsPhase: stateSlice.marchingAntsPhase,
      errorMessage: stateSlice.errorMessage,
      pastePreviewTarget: stateSlice.pastePreviewTarget,
      snapshot,

      // Convenience methods
      copySelection,
      cutSelection,
      pasteToSelection,
      pasteValues,
      pasteFormulas,
      pasteFormats,

      // Low-level actions
      copy,
      cut,
      clear,
      paste,
      pasteSpecial,
      pasteExternal,
      showPastePreview,
      hidePastePreview,

      // Animation actions
      tickMarchingAnts,
    }),
    [
      snapshot,
      stateSlice,
      copySelection,
      cutSelection,
      pasteToSelection,
      pasteValues,
      pasteFormulas,
      pasteFormats,
      copy,
      cut,
      clear,
      paste,
      pasteSpecial,
      pasteExternal,
      showPastePreview,
      hidePastePreview,
      tickMarchingAnts,
    ],
  );
}

export {
  useClipboardEvents,
  type UseClipboardEventsOptions,
  type UseClipboardEventsReturn,
} from './use-clipboard-events';
