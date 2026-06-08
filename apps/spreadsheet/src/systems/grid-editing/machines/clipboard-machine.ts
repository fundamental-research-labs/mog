/**
 * Clipboard State Machine
 *
 * Manages copy/cut/paste operations including internal and external clipboard,
 * paste preview, and paste special.
 *
 * States:
 * - empty: No clipboard data
 * - hasCopy: Copied data available
 * - hasCut: Cut data available (source shows marching ants)
 * - pastePreview: Showing preview of paste result
 * - pasting: Paste operation in progress
 * - pasteError: Paste failed, data still available for retry
 *
 * Key behaviors:
 * - Cut can be invalidated if source cells are modified (converts to copy)
 * - Internal clipboard preserves full fidelity (formulas, formats)
 * - External clipboard (from other apps) is parsed into internal format
 * - Paste preview shows what will change before committing
 *
 * TODO: ViewClipboardData type will need to be updated to support view-specific clipboard data
 * when implementing multi-view support (grid, pivot, chart views may have different clipboard formats)
 *
 * @see ARCHITECTURE.md for design decisions
 */

import { assign, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';

import { EXTERNAL_SOURCE_SHEET_ID } from '@mog-sdk/contracts/actors';
import { clipboardSelectors } from '../../../selectors';
import type {
  IClipboardService,
  ClipboardPayload as KernelClipboardPayload,
} from '@mog-sdk/contracts/services';
import type { ViewClipboardData, ViewId, ViewType } from '../../../views/types';
import type {
  CellCoord,
  CellFormat,
  CellRange,
  ClipboardData,
  ExternalPastePayload,
  ClipboardSnapshot,
  PasteSpecialOptions,
} from '../../shared/types';
// Utils for clipboard operations
import {
  adjustRange,
  changeAffectsSheet,
  parseHTML,
  type StructureChange,
} from '../../shared/utils';
import { parseClipboardText } from '../../../domain/clipboard/clipboard-parser';

const MAX_EXTERNAL_CELL_TEXT_CHARS = 32767;

// =============================================================================
// CONTEXT
// =============================================================================

export interface ClipboardContext {
  /** The ranges that were copied/cut (for grid-specific operations, may be null for non-grid views) */
  sourceRanges: CellRange[] | null;
  /**
   * Full clipboard data in grid-specific format (legacy).
   * @deprecated Use viewData for new code. This is kept for backward compatibility
   * with existing grid-specific paste logic.
   */
  data: ClipboardData | null;
  /**
   * View-agnostic clipboard data (multi-format).
   * This is the primary clipboard storage for cross-view operations.
   * Contains text (always), cells (for formula-preserving paste), and records (for table-aware views).
   */
  viewData: ViewClipboardData | null;
  /** Whether current clipboard is from a cut operation */
  isCut: boolean;
  /** Target cell for paste preview */
  pastePreviewTarget: CellCoord | null;
  /** Current phase for marching ants animation (0-7) */
  marchingAntsPhase: number;
  /** Error message from failed paste */
  errorMessage: string | null;
  /** Paste special options for current operation */
  pasteOptions: PasteSpecialOptions | null;
  /** Whether to skip size mismatch check (user already confirmed) */
  skipSizeCheck: boolean;
  /**
   * Whether to skip the cut-paste overwrite confirmation check
   * (user already confirmed via the overwrite confirmation dialog).
   */
  skipOverwriteCheck: boolean;
  /**
   * Whether clipboard data is stale (app lost focus).
   * When stale, internal clipboard may be out of sync with system clipboard.
   * A new copy from external source will overwrite internal data.
   */
  isStale: boolean;
  /**
   * Optional kernel clipboard service for storage delegation.
   * When provided, copy/cut operations are also stored in the kernel service.
   * The shell machine keeps its own UI state (marching ants, paste preview, etc.).
   * @internal Set via machine input
   */
  kernelClipboardService?: IClipboardService;
  /**
   * App-owned text signature from a canceled or consumed internal copy/cut.
   * If the browser clipboard still contains this TSV, paste should no-op
   * instead of importing it as external text after the internal state is clear.
   */
  suppressedTextSignature: string | null;
}

/**
 * Input for the clipboard machine.
 * Allows optional kernel clipboard service for delegation.
 */
export interface ClipboardMachineInput {
  /**
   * Optional kernel clipboard service for storage delegation.
   * When provided, copy/cut operations are also stored in the kernel service.
   * The shell machine keeps its own UI state (marching ants, paste preview, etc.).
   */
  kernelClipboardService?: IClipboardService;
}

const initialContext: ClipboardContext = {
  sourceRanges: null,
  data: null,
  viewData: null,
  isCut: false,
  pastePreviewTarget: null,
  marchingAntsPhase: 0,
  errorMessage: null,
  pasteOptions: null,
  skipSizeCheck: false,
  skipOverwriteCheck: false,
  isStale: false,
  kernelClipboardService: undefined,
  suppressedTextSignature: null,
};

// =============================================================================
// EVENTS
// =============================================================================

export type ClipboardEvent =
  | { type: 'COPY'; ranges: CellRange[]; data: ClipboardData; viewData?: ViewClipboardData }
  | { type: 'CUT'; ranges: CellRange[]; data: ClipboardData; viewData?: ViewClipboardData }
  | { type: 'COPY_VIEW'; viewData: ViewClipboardData }
  | { type: 'CUT_VIEW'; viewData: ViewClipboardData }
  | { type: 'PASTE'; targetCell: CellCoord; skipSizeCheck?: boolean; skipOverwriteCheck?: boolean }
  | {
      type: 'PASTE_SPECIAL';
      targetCell: CellCoord;
      options: PasteSpecialOptions;
      skipSizeCheck?: boolean;
      skipOverwriteCheck?: boolean;
    }
  | { type: 'SHOW_PASTE_PREVIEW'; targetCell: CellCoord }
  | { type: 'HIDE_PASTE_PREVIEW' }
  | { type: 'PASTE_COMPLETE' }
  | { type: 'PASTE_ERROR'; message: string }
  | { type: 'INVALIDATE_CUT' }
  | { type: 'CLEAR' }
  | ({ type: 'EXTERNAL_PASTE' } & ExternalPastePayload)
  | { type: 'TICK_MARCHING_ANTS' }
  // Issue 1: Structure Change Coordination - Adjust source ranges after row/column insert/delete
  | { type: 'STRUCTURE_CHANGE'; sheetId: string; change: StructureChange }
  // Clear clipboard when user starts editing any cell (Excel parity)
  | { type: 'CELL_EDIT' }
  // Mark copy as stale when app loses focus
  | { type: 'FOCUS_LOST' }
  | { type: 'EDIT_MODE_COPY'; text: string };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the clipboard machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const ClipboardEvents = {
  copy: (
    ranges: CellRange[],
    data: ClipboardData,
    viewData?: ViewClipboardData,
  ): ClipboardEvent => ({
    type: 'COPY',
    ranges,
    data,
    viewData,
  }),

  cut: (
    ranges: CellRange[],
    data: ClipboardData,
    viewData?: ViewClipboardData,
  ): ClipboardEvent => ({
    type: 'CUT',
    ranges,
    data,
    viewData,
  }),

  /**
   * Copy from a view adapter (view-agnostic clipboard data).
   * Use this for non-grid views that don't have CellRange/ClipboardData.
   */
  copyView: (viewData: ViewClipboardData): ClipboardEvent => ({
    type: 'COPY_VIEW',
    viewData,
  }),

  /**
   * Cut from a view adapter (view-agnostic clipboard data).
   * Use this for non-grid views that don't have CellRange/ClipboardData.
   */
  cutView: (viewData: ViewClipboardData): ClipboardEvent => ({
    type: 'CUT_VIEW',
    viewData,
  }),

  paste: (
    targetCell: CellCoord,
    skipSizeCheck?: boolean,
    skipOverwriteCheck?: boolean,
  ): ClipboardEvent => ({
    type: 'PASTE',
    targetCell,
    skipSizeCheck,
    skipOverwriteCheck,
  }),

  pasteSpecial: (
    targetCell: CellCoord,
    options: PasteSpecialOptions,
    skipSizeCheck?: boolean,
    skipOverwriteCheck?: boolean,
  ): ClipboardEvent => ({
    type: 'PASTE_SPECIAL',
    targetCell,
    options,
    skipSizeCheck,
    skipOverwriteCheck,
  }),

  showPastePreview: (targetCell: CellCoord): ClipboardEvent => ({
    type: 'SHOW_PASTE_PREVIEW',
    targetCell,
  }),

  hidePastePreview: (): ClipboardEvent => ({
    type: 'HIDE_PASTE_PREVIEW',
  }),

  pasteComplete: (): ClipboardEvent => ({
    type: 'PASTE_COMPLETE',
  }),

  pasteError: (message: string): ClipboardEvent => ({
    type: 'PASTE_ERROR',
    message,
  }),

  invalidateCut: (): ClipboardEvent => ({
    type: 'INVALIDATE_CUT',
  }),

  clear: (): ClipboardEvent => ({
    type: 'CLEAR',
  }),

  externalPaste: (payload: ExternalPastePayload): ClipboardEvent => ({
    type: 'EXTERNAL_PASTE',
    ...payload,
  }),

  tickMarchingAnts: (): ClipboardEvent => ({
    type: 'TICK_MARCHING_ANTS',
  }),

  structureChange: (sheetId: string, change: StructureChange): ClipboardEvent => ({
    type: 'STRUCTURE_CHANGE',
    sheetId,
    change,
  }),

  // Clear clipboard on cell edit
  cellEdit: (): ClipboardEvent => ({
    type: 'CELL_EDIT',
  }),

  // Mark copy as stale when app loses focus
  focusLost: (): ClipboardEvent => ({
    type: 'FOCUS_LOST',
  }),
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert shell's ClipboardData to kernel's ClipboardPayload format.
 * This allows delegating storage to the kernel clipboard service.
 *
 * @param data - Shell's grid-specific ClipboardData
 * @param viewData - Optional view-agnostic data
 * @returns KernelClipboardPayload or null if conversion not possible
 */
function convertToKernelPayload(
  data: ClipboardData | null,
  viewData?: ViewClipboardData | null,
): KernelClipboardPayload | null {
  // If we have viewData with cells format, convert that (preferred)
  if (viewData?.cells) {
    const cellsData = viewData.cells;
    const rowCount = cellsData.data.length;
    const colCount = rowCount > 0 ? cellsData.data[0].length : 0;

    // Extract values, formulas, and formats from CellData[][]
    const values: unknown[][] = [];
    const formulas: (string | null)[][] = [];
    const formats: (Partial<CellFormat> | null)[][] = [];

    for (let r = 0; r < rowCount; r++) {
      const rowValues: unknown[] = [];
      const rowFormulas: (string | null)[] = [];
      const rowFormats: (Partial<CellFormat> | null)[] = [];

      for (let c = 0; c < colCount; c++) {
        const cell = cellsData.data[r]?.[c];
        if (cell) {
          // Use value from CellData
          rowValues.push(cell.value);
          // Formula is stored with leading '=' in CellData
          rowFormulas.push(cell.formula ?? null);
          // Format from CellData
          rowFormats.push(cell.format ?? null);
        } else {
          rowValues.push(null);
          rowFormulas.push(null);
          rowFormats.push(null);
        }
      }

      values.push(rowValues);
      formulas.push(rowFormulas);
      formats.push(rowFormats);
    }

    // Build TSV text
    const text = values.map((row) => row.map((v) => (v ?? '').toString()).join('\t')).join('\n');

    return {
      cells: {
        values,
        formulas: formulas.some((row) => row.some((f) => f !== null)) ? formulas : undefined,
        formats: formats.some((row) => row.some((f) => f !== null)) ? formats : undefined,
        rowCount,
        colCount,
      },
      source: {
        viewType: viewData.source.viewType,
        viewId: viewData.source.viewId,
        sheetId: cellsData.sheetId,
      },
      text,
    };
  }

  // Fall back to converting grid-specific ClipboardData
  if (data) {
    const { sourceRanges, cells, sourceSheetId } = data;
    if (!sourceRanges || sourceRanges.length === 0) return null;

    const range = sourceRanges[0];
    const rowCount = range.endRow - range.startRow + 1;
    const colCount = range.endCol - range.startCol + 1;

    const values: unknown[][] = [];
    const formulas: (string | null)[][] = [];
    const formats: (Partial<CellFormat> | null)[][] = [];

    for (let r = 0; r < rowCount; r++) {
      const rowValues: unknown[] = [];
      const rowFormulas: (string | null)[] = [];
      const rowFormats: (Partial<CellFormat> | null)[] = [];

      for (let c = 0; c < colCount; c++) {
        const key = `${r},${c}`;
        const cell = cells[key];
        if (cell) {
          rowValues.push(cell.raw);
          rowFormulas.push(cell.formula ?? null);
          rowFormats.push(cell.format ?? null);
        } else {
          rowValues.push(null);
          rowFormulas.push(null);
          rowFormats.push(null);
        }
      }

      values.push(rowValues);
      formulas.push(rowFormulas);
      formats.push(rowFormats);
    }

    // Build TSV text
    const text = values.map((row) => row.map((v) => (v ?? '').toString()).join('\t')).join('\n');

    return {
      cells: {
        values,
        formulas: formulas.some((row) => row.some((f) => f !== null)) ? formulas : undefined,
        formats: formats.some((row) => row.some((f) => f !== null)) ? formats : undefined,
        rowCount,
        colCount,
      },
      source: {
        viewType: 'grid' as ViewType,
        viewId: null as ViewId | null,
        sheetId: sourceSheetId,
      },
      text,
    };
  }

  return null;
}

/**
 * Parse external clipboard data into ClipboardData.
 * Prefers HTML when available (preserves formatting from Excel/Google Sheets),
 * falls back to TSV/plain text.
 *
 * @param text - Plain text from clipboard (TSV format)
 * @param html - Optional HTML from clipboard (preserves styles)
 */
function parseExternalData(
  text: string,
  html?: string,
): {
  data: ClipboardData;
  sourceRanges: CellRange[];
} {
  // Try HTML first if available (preserves formatting)
  if (html) {
    const parsedHTML = parseHTML(html);
    if (parsedHTML && parsedHTML.cells.length > 0) {
      return buildClipboardDataFromParsed(parsedHTML.cells, parsedHTML.formats);
    }
  }

  // Fall back to TSV parsing
  return parseExternalText(text);
}

/**
 * Parse external clipboard text (TSV or CSV format) into ClipboardData.
 * Used as fallback when HTML is not available or doesn't contain a table.
 * Auto-detects CSV vs TSV based on delimiter counts.
 */
function parseExternalText(text: string): {
  data: ClipboardData;
  sourceRanges: CellRange[];
} {
  const cells = parseClipboardText(text);
  return buildClipboardDataFromParsed(cells);
}

/**
 * Build ClipboardData from parsed 2D cell arrays.
 * Shared by both HTML and TSV parsing paths.
 */
function buildClipboardDataFromParsed(
  cells: string[][],
  formats?: (Partial<CellFormat> | undefined)[][],
): {
  data: ClipboardData;
  sourceRanges: CellRange[];
} {
  const clipboardCells: Record<string, { raw: unknown; formula?: string; format?: CellFormat }> =
    {};

  cells.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      const key = `${rowIndex},${colIndex}`;
      const parsedValue = truncateExternalCellText(value);

      const cellData: { raw: unknown; formula?: string; format?: CellFormat } = {
        raw: parsedValue,
      };

      // Add format if available
      if (formats && formats[rowIndex] && formats[rowIndex][colIndex]) {
        cellData.format = formats[rowIndex][colIndex] as CellFormat;
      }

      clipboardCells[key] = cellData;
    });
  });

  const rowCount = cells.length;
  const colCount = Math.max(1, ...cells.map((row) => row.length));

  const sourceRanges: CellRange[] = [
    {
      startRow: 0,
      startCol: 0,
      endRow: Math.max(0, rowCount - 1),
      endCol: Math.max(0, colCount - 1),
    },
  ];

  return {
    data: {
      sourceRanges,
      cells: clipboardCells,
      sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
    },
    sourceRanges,
  };
}

function truncateExternalCellText(value: string): string {
  if (value.length <= MAX_EXTERNAL_CELL_TEXT_CHARS) return value;

  let end = MAX_EXTERNAL_CELL_TEXT_CHARS;
  const prev = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    end--;
  }
  return value.slice(0, end);
}

function getInternalTextSignature(context: ClipboardContext): string | null {
  const signature = context.data?.textSignature;
  if (!signature || context.data?.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID) {
    return null;
  }
  return signature;
}

// =============================================================================
// MACHINE DEFINITION
// =============================================================================

export const clipboardMachine = setup({
  types: {
    context: {} as ClipboardContext,
    events: {} as ClipboardEvent,
    input: {} as ClipboardMachineInput,
  },
  actions: {
    // Store copy data (grid-specific with optional view data)
    // Also delegates to kernel clipboard service if provided
    storeCopyData: assign(({ context, event }) => {
      if (event.type !== 'COPY') return {};

      // Delegate to kernel clipboard service if available
      const kernelService = context.kernelClipboardService;
      if (kernelService) {
        const payload = convertToKernelPayload(event.data, event.viewData);
        if (payload) {
          kernelService.copy(payload);
        }
      }

      return {
        sourceRanges: event.ranges,
        data: event.data,
        viewData: event.viewData ?? null,
        isCut: false,
        errorMessage: null,
        isStale: false,
        suppressedTextSignature: null,
      };
    }),

    // Store cut data (grid-specific with optional view data)
    // Also delegates to kernel clipboard service if provided
    storeCutData: assign(({ context, event }) => {
      if (event.type !== 'CUT') return {};

      // Delegate to kernel clipboard service if available
      const kernelService = context.kernelClipboardService;
      if (kernelService) {
        const payload = convertToKernelPayload(event.data, event.viewData);
        if (payload) {
          kernelService.cut(payload);
        }
      }

      return {
        sourceRanges: event.ranges,
        data: event.data,
        viewData: event.viewData ?? null,
        isCut: true,
        errorMessage: null,
        isStale: false,
        suppressedTextSignature: null,
      };
    }),

    // Store copy data from view adapter (view-agnostic)
    // Also delegates to kernel clipboard service if provided
    storeViewCopyData: assign(({ context, event }) => {
      if (event.type !== 'COPY_VIEW') return {};

      // Delegate to kernel clipboard service if available
      const kernelService = context.kernelClipboardService;
      if (kernelService) {
        const payload = convertToKernelPayload(null, event.viewData);
        if (payload) {
          kernelService.copy(payload);
        }
      }

      return {
        sourceRanges: null, // No grid-specific ranges for view-agnostic copy
        data: null, // No grid-specific data for view-agnostic copy
        viewData: event.viewData,
        isCut: false,
        errorMessage: null,
        isStale: false,
        suppressedTextSignature: null,
      };
    }),

    // Store cut data from view adapter (view-agnostic)
    // Also delegates to kernel clipboard service if provided
    storeViewCutData: assign(({ context, event }) => {
      if (event.type !== 'CUT_VIEW') return {};

      // Delegate to kernel clipboard service if available
      const kernelService = context.kernelClipboardService;
      if (kernelService) {
        const payload = convertToKernelPayload(null, event.viewData);
        if (payload) {
          kernelService.cut(payload);
        }
      }

      return {
        sourceRanges: null, // No grid-specific ranges for view-agnostic cut
        data: null, // No grid-specific data for view-agnostic cut
        viewData: event.viewData,
        isCut: true,
        errorMessage: null,
        isStale: false,
        suppressedTextSignature: null,
      };
    }),

    // Convert cut to copy (when source is modified)
    convertCutToCopy: assign(() => ({
      isCut: false,
    })),

    // Set paste preview target (and skipSizeCheck for PASTE events)
    setPastePreviewTarget: assign(({ event }) => {
      if (
        event.type !== 'SHOW_PASTE_PREVIEW' &&
        event.type !== 'PASTE' &&
        event.type !== 'PASTE_SPECIAL'
      ) {
        return {};
      }
      return {
        pastePreviewTarget: event.targetCell,
        // Capture retry flags from paste events.
        skipSizeCheck:
          event.type === 'PASTE' || event.type === 'PASTE_SPECIAL'
            ? (event.skipSizeCheck ?? false)
            : false,
        // Cut-paste overwrite: capture skipOverwriteCheck flag from paste events
        // (set when the user has confirmed the overwrite via the dialog).
        skipOverwriteCheck:
          event.type === 'PASTE' || event.type === 'PASTE_SPECIAL'
            ? (event.skipOverwriteCheck ?? false)
            : false,
      };
    }),

    // Clear paste preview
    clearPastePreview: assign(() => ({
      pastePreviewTarget: null,
    })),

    // Set paste options for paste special
    setPasteOptions: assign(({ event }) => {
      if (event.type !== 'PASTE_SPECIAL') return {};
      return {
        pasteOptions: event.options,
      };
    }),

    // Clear paste options
    clearPasteOptions: assign(() => ({
      pasteOptions: null,
    })),

    // Clear clipboard after successful cut-paste
    // Also clears kernel clipboard service if available
    clearClipboardAfterCut: assign(({ context }) => {
      // Delegate to kernel clipboard service
      context.kernelClipboardService?.clear();
      const suppressedTextSignature = getInternalTextSignature(context);

      return {
        sourceRanges: null,
        data: null,
        viewData: null,
        isCut: false,
        pastePreviewTarget: null,
        marchingAntsPhase: 0,
        suppressedTextSignature,
      };
    }),

    // Set error message
    setError: assign(({ event }) => {
      if (event.type !== 'PASTE_ERROR') return {};
      return {
        errorMessage: event.message,
      };
    }),

    // Clear all clipboard data
    // Also clears kernel clipboard service if available
    clearAll: assign(({ context }) => {
      // Delegate to kernel clipboard service
      context.kernelClipboardService?.clear();
      const suppressedTextSignature =
        getInternalTextSignature(context) ?? context.suppressedTextSignature;

      return {
        sourceRanges: null,
        data: null,
        viewData: null,
        isCut: false,
        pastePreviewTarget: null,
        marchingAntsPhase: 0,
        errorMessage: null,
        pasteOptions: null,
        isStale: false,
        suppressedTextSignature,
      };
    }),

    // Mark clipboard as stale when app loses focus
    // Also marks kernel clipboard service as stale if available
    markStale: assign(({ context }) => {
      // Delegate to kernel clipboard service
      context.kernelClipboardService?.markStale();

      return { isStale: true };
    }),

    // Clear stale flag (e.g., when new copy/cut occurs)
    // Also marks kernel clipboard service as fresh if available
    clearStale: assign(({ context }) => {
      // Delegate to kernel clipboard service
      context.kernelClipboardService?.markFresh();

      return { isStale: false };
    }),

    // Advance marching ants animation
    tickMarchingAnts: assign(({ context }) => ({
      marchingAntsPhase: (context.marchingAntsPhase + 1) % 8,
    })),

    storeEditModeCopyData: assign(({ event }) => {
      if (event.type !== 'EDIT_MODE_COPY') return {};
      return {
        sourceRanges: [],
        data: {
          textSignature: event.text,
          sourceRanges: [],
          sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
          cells: {},
        } satisfies ClipboardData,
        viewData: null,
        isCut: false,
        errorMessage: null,
        isStale: false,
        suppressedTextSignature: null,
      };
    }),

    // Store external paste data (parse text/html into internal format)
    // Prefers HTML when available to preserve formatting from Excel/Google Sheets
    storeExternalPasteData: assign(({ event }) => {
      if (event.type !== 'EXTERNAL_PASTE') return {};
      const { data, sourceRanges } = parseExternalData(event.text, event.html);
      return {
        data,
        sourceRanges,
        isCut: false,
        pastePreviewTarget: event.targetCell,
        pasteOptions: event.options ?? null,
        suppressedTextSignature: null,
      };
    }),

    // =========================================================================
    // Issue 1: Structure Change Coordination
    // =========================================================================

    /**
     * Adjust clipboard source ranges after structure change.
     * If all source ranges are deleted, invalidate the clipboard.
     */
    adjustSourceRanges: assign(({ context, event }) => {
      if (event.type !== 'STRUCTURE_CHANGE') return {};

      // Skip if no clipboard data or source is from a different sheet
      if (!context.sourceRanges || !context.data) return {};
      if (!changeAffectsSheet(event.change, context.data.sourceSheetId)) return {};

      // Adjust all source ranges
      const newRanges = context.sourceRanges
        .map((r) => adjustRange(r, event.change))
        .filter((r): r is CellRange => r !== null);

      // If all ranges were deleted, invalidate clipboard
      if (newRanges.length === 0) {
        return {
          sourceRanges: null,
          data: null,
          isCut: false,
          suppressedTextSignature:
            getInternalTextSignature(context) ?? context.suppressedTextSignature,
        };
      }

      // Update source ranges in both context and data
      return {
        sourceRanges: newRanges,
        data: {
          ...context.data,
          sourceRanges: newRanges,
        },
      };
    }),
  },
  guards: {
    // Check if clipboard data exists (either grid-specific or view-agnostic)
    hasData: ({ context }) => context.data !== null || context.viewData !== null,
    // Check if this is a cut operation
    isCutOperation: ({ context }) => context.isCut,
    // Check if this is NOT a cut operation
    isNotCutOperation: ({ context }) => !context.isCut,

    // Issue 1: Structure Change Coordination
    // Check if structure change invalidated all source ranges
    // Note: This only applies to grid-specific clipboard data with sourceRanges
    isSourceRangesInvalidated: ({ context, event }) => {
      if (event.type !== 'STRUCTURE_CHANGE') return false;
      // Only applies to grid-specific data with source ranges
      if (!context.sourceRanges || !context.data) return false;
      if (!changeAffectsSheet(event.change, context.data.sourceSheetId)) return false;

      // Check if all ranges would be deleted
      const remainingRanges = context.sourceRanges
        .map((r) => adjustRange(r, event.change))
        .filter((r) => r !== null);

      return remainingRanges.length === 0;
    },
  },
}).createMachine({
  id: 'clipboard',
  initial: 'empty',
  context: ({ input }) => ({
    ...initialContext,
    // Store kernel clipboard service from input for delegation
    kernelClipboardService: input?.kernelClipboardService,
  }),

  states: {
    // =========================================================================
    // EMPTY - No clipboard data
    // =========================================================================
    empty: {
      on: {
        COPY: {
          target: 'hasCopy',
          actions: 'storeCopyData',
        },
        CUT: {
          target: 'hasCut',
          actions: 'storeCutData',
        },
        COPY_VIEW: {
          target: 'hasCopy',
          actions: 'storeViewCopyData',
        },
        CUT_VIEW: {
          target: 'hasCut',
          actions: 'storeViewCutData',
        },
        EXTERNAL_PASTE: {
          target: 'pasting',
          actions: 'storeExternalPasteData',
        },
        EDIT_MODE_COPY: {
          target: 'hasCopy',
          actions: 'storeEditModeCopyData',
        },
      },
    },

    // =========================================================================
    // HAS_COPY - Copied data available (can paste multiple times)
    // G1: Marching ants for copy (Excel parity quickwin)
    // =========================================================================
    hasCopy: {
      on: {
        COPY: {
          target: 'hasCopy',
          actions: 'storeCopyData',
          reenter: true,
        },
        CUT: {
          target: 'hasCut',
          actions: 'storeCutData',
        },
        COPY_VIEW: {
          target: 'hasCopy',
          actions: 'storeViewCopyData',
          reenter: true,
        },
        CUT_VIEW: {
          target: 'hasCut',
          actions: 'storeViewCutData',
        },
        PASTE: {
          target: 'pasting',
          actions: 'setPastePreviewTarget',
        },
        PASTE_SPECIAL: {
          target: 'pasting',
          actions: ['setPastePreviewTarget', 'setPasteOptions'],
        },
        SHOW_PASTE_PREVIEW: {
          target: 'pastePreview',
          actions: 'setPastePreviewTarget',
        },
        CLEAR: {
          target: 'empty',
          actions: 'clearAll',
        },
        EXTERNAL_PASTE: {
          target: 'pasting',
          actions: 'storeExternalPasteData',
        },
        EDIT_MODE_COPY: {
          target: 'hasCopy',
          actions: 'storeEditModeCopyData',
          reenter: true,
        },
        // G1: Marching ants animation tick (same as hasCut)
        TICK_MARCHING_ANTS: {
          actions: 'tickMarchingAnts',
        },
        // Issue 1: Structure Change Coordination
        // Adjust source ranges when structure changes; clear if all ranges deleted
        STRUCTURE_CHANGE: [
          {
            guard: 'isSourceRangesInvalidated',
            target: 'empty',
            actions: 'clearAll',
          },
          {
            actions: 'adjustSourceRanges',
          },
        ],
        // Clear clipboard when user starts editing any cell (Excel parity)
        CELL_EDIT: {
          target: 'empty',
          actions: 'clearAll',
        },
        // Mark clipboard as stale when app loses focus
        FOCUS_LOST: {
          actions: 'markStale',
        },
      },
    },

    // =========================================================================
    // HAS_CUT - Cut data available (source shows marching ants)
    // =========================================================================
    hasCut: {
      on: {
        COPY: {
          target: 'hasCopy',
          actions: 'storeCopyData',
        },
        CUT: {
          target: 'hasCut',
          actions: 'storeCutData',
          reenter: true,
        },
        COPY_VIEW: {
          target: 'hasCopy',
          actions: 'storeViewCopyData',
        },
        CUT_VIEW: {
          target: 'hasCut',
          actions: 'storeViewCutData',
          reenter: true,
        },
        PASTE: {
          target: 'pasting',
          actions: 'setPastePreviewTarget',
        },
        PASTE_SPECIAL: {
          target: 'pasting',
          actions: ['setPastePreviewTarget', 'setPasteOptions'],
        },
        SHOW_PASTE_PREVIEW: {
          target: 'pastePreview',
          actions: 'setPastePreviewTarget',
        },
        // Cut source was modified by another user or operation
        INVALIDATE_CUT: {
          target: 'hasCopy',
          actions: 'convertCutToCopy',
        },
        CLEAR: {
          target: 'empty',
          actions: 'clearAll',
        },
        EXTERNAL_PASTE: {
          target: 'pasting',
          actions: 'storeExternalPasteData',
        },
        EDIT_MODE_COPY: {
          target: 'hasCopy',
          actions: 'storeEditModeCopyData',
        },
        // Marching ants animation tick
        TICK_MARCHING_ANTS: {
          actions: 'tickMarchingAnts',
        },
        // Issue 1: Structure Change Coordination
        // Adjust source ranges when structure changes; clear if all ranges deleted
        STRUCTURE_CHANGE: [
          {
            guard: 'isSourceRangesInvalidated',
            target: 'empty',
            actions: 'clearAll',
          },
          {
            actions: 'adjustSourceRanges',
          },
        ],
        // Clear clipboard when user starts editing any cell (Excel parity)
        CELL_EDIT: {
          target: 'empty',
          actions: 'clearAll',
        },
        // Mark clipboard as stale when app loses focus
        FOCUS_LOST: {
          actions: 'markStale',
        },
      },
    },

    // =========================================================================
    // PASTE_PREVIEW - Showing preview of what will be pasted
    // =========================================================================
    pastePreview: {
      on: {
        HIDE_PASTE_PREVIEW: [
          {
            target: 'hasCut',
            actions: 'clearPastePreview',
            guard: 'isCutOperation',
          },
          {
            target: 'hasCopy',
            actions: 'clearPastePreview',
          },
        ],
        PASTE: {
          target: 'pasting',
          actions: 'setPastePreviewTarget',
        },
        PASTE_SPECIAL: {
          target: 'pasting',
          actions: ['setPastePreviewTarget', 'setPasteOptions'],
        },
        SHOW_PASTE_PREVIEW: {
          // Update preview target
          actions: 'setPastePreviewTarget',
        },
        EXTERNAL_PASTE: {
          target: 'pasting',
          actions: 'storeExternalPasteData',
        },
        CLEAR: {
          target: 'empty',
          actions: 'clearAll',
        },
        // Can still tick marching ants in preview
        TICK_MARCHING_ANTS: {
          actions: 'tickMarchingAnts',
        },
        // Issue 1: Structure Change Coordination
        // Adjust source ranges when structure changes; clear if all ranges deleted
        STRUCTURE_CHANGE: [
          {
            guard: 'isSourceRangesInvalidated',
            target: 'empty',
            actions: 'clearAll',
          },
          {
            actions: 'adjustSourceRanges',
          },
        ],
      },
    },

    // =========================================================================
    // PASTE_ERROR - Paste failed, data still available for retry
    // Distinct from hasCopy so consumers can detect error state
    // =========================================================================
    pasteError: {
      on: {
        COPY: {
          target: 'hasCopy',
          actions: 'storeCopyData',
        },
        CUT: {
          target: 'hasCut',
          actions: 'storeCutData',
        },
        COPY_VIEW: {
          target: 'hasCopy',
          actions: 'storeViewCopyData',
        },
        CUT_VIEW: {
          target: 'hasCut',
          actions: 'storeViewCutData',
        },
        PASTE: {
          target: 'pasting',
          actions: 'setPastePreviewTarget',
        },
        PASTE_SPECIAL: {
          target: 'pasting',
          actions: ['setPastePreviewTarget', 'setPasteOptions'],
        },
        SHOW_PASTE_PREVIEW: {
          target: 'pastePreview',
          actions: 'setPastePreviewTarget',
        },
        CLEAR: {
          target: 'empty',
          actions: 'clearAll',
        },
        EXTERNAL_PASTE: {
          target: 'pasting',
          actions: 'storeExternalPasteData',
        },
        TICK_MARCHING_ANTS: {
          actions: 'tickMarchingAnts',
        },
        STRUCTURE_CHANGE: [
          {
            guard: 'isSourceRangesInvalidated',
            target: 'empty',
            actions: 'clearAll',
          },
          {
            actions: 'adjustSourceRanges',
          },
        ],
        CELL_EDIT: {
          target: 'empty',
          actions: 'clearAll',
        },
        FOCUS_LOST: {
          actions: 'markStale',
        },
      },
    },

    // =========================================================================
    // PASTING - Paste operation in progress
    // =========================================================================
    pasting: {
      on: {
        PASTE_COMPLETE: [
          {
            // If was cut, clear clipboard (cut is one-time)
            target: 'empty',
            guard: 'isCutOperation',
            actions: 'clearClipboardAfterCut',
          },
          {
            // If was copy, keep data (can paste again)
            target: 'hasCopy',
            actions: ['clearPastePreview', 'clearPasteOptions'],
          },
        ],
        PASTE_ERROR: [
          {
            target: 'hasCut',
            actions: ['setError', 'clearPastePreview', 'clearPasteOptions'],
            guard: 'isCutOperation',
          },
          {
            target: 'pasteError',
            actions: ['setError', 'clearPastePreview', 'clearPasteOptions'],
          },
        ],
        // Allow CLEAR during pasting (e.g. Enter-paste which is one-time).
        // The paste is already committed by the coordinator; the machine just
        // moves to empty so that PASTE_COMPLETE (arriving late) is ignored.
        CLEAR: {
          target: 'empty',
          actions: 'clearAll',
        },
      },
    },
  },
});

// =============================================================================
// SNAPSHOT HELPER
// =============================================================================

/**
 * Extract ClipboardSnapshot from machine state for external consumers.
 * G1/G2: Now includes copySource for marching ants on copy operations.
 *
 * ARCHITECTURE: Uses selectors from contracts as the single source of truth.
 * Each field calls the corresponding selector - no extraction logic is duplicated here.
 */
export function getClipboardSnapshot(
  state: ReturnType<typeof clipboardMachine.getInitialSnapshot>,
): ClipboardSnapshot {
  // Cast state to compatible type for selectors
  const s = state as Parameters<(typeof clipboardSelectors)['hasCopy']>[0];

  return {
    hasCopy: clipboardSelectors.hasCopyAvailable(s),
    hasCut: clipboardSelectors.hasCut(s),
    cutSource: clipboardSelectors.cutSource(s),
    copySource: clipboardSelectors.copySource(s),
    isPasting: clipboardSelectors.isPasting(s),
    sourceSheetId: clipboardSelectors.sourceSheetId(s),
  };
}

// =============================================================================
// FACTORY HELPERS
// =============================================================================

/**
 * Create clipboard data from cell ranges.
 * This helper is used by the coordinator to build ClipboardData.
 */
export function createClipboardData(
  ranges: CellRange[],
  cells: Record<string, { raw: unknown; formula?: string }>,
  sheetId: string,
): ClipboardData {
  return {
    sourceRanges: ranges,
    cells,
    sourceSheetId: sheetId,
  };
}

// =============================================================================
// ACTOR TYPES
// =============================================================================

export type ClipboardMachine = typeof clipboardMachine;
export type ClipboardActor = ActorRefFrom<ClipboardMachine>;
export type ClipboardState = SnapshotFrom<ClipboardMachine>;
