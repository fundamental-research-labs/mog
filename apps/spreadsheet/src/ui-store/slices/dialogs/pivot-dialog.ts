/**
 * Pivot Table Dialog Slice
 *
 * Manages state for pivot table creation and editing UI.
 */

import type { StateCreator } from 'zustand';
import type { PlacementId } from '@mog-sdk/contracts/pivot';
import type { PivotDialogDraft, PivotDialogSession } from '../../../systems/pivot';

/**
 * Location mode for pivot table output placement.
 * - 'newWorksheet': Create a new sheet dedicated to the pivot table (default)
 * - 'existingWorksheet': Place on an existing sheet at a user-specified cell
 */
export type PivotLocationMode = 'newWorksheet' | 'existingWorksheet';

export type PivotTransientOverlay =
  | null
  | { kind: 'field-header-menu'; pivotId: string; placementId: PlacementId }
  | { kind: 'report-filter-menu'; pivotId: string; placementId: PlacementId }
  | { kind: 'context-menu'; pivotId: string; target: unknown };

export type PivotOverlayDismissReason =
  | 'outside-pointer'
  | 'escape'
  | 'selection-change'
  | 'sheet-change'
  | 'scroll'
  | 'panel-open'
  | 'command-applied'
  | 'pivot-deleted'
  | 'placement-changed';

export const DEFAULT_PIVOT_FIELD_PANEL_WIDTH = 320;
export const MIN_PIVOT_FIELD_PANEL_WIDTH = 280;
export const MAX_PIVOT_FIELD_PANEL_WIDTH = 640;

/**
 * Pivot table UI state
 */
export interface PivotUIState {
  /** Whether the creation dialog is open */
  isDialogOpen: boolean;
  /** Currently selected pivot table ID */
  selectedPivotId: string | null;
  /** Pivot being edited (field panel open) */
  editingPivotId: string | null;
  /** Pivot whose field panel was explicitly closed by the user. */
  fieldPanelSuppressedPivotId: string | null;
  /** Transient pivot overlay/menu owned by pivot interaction state */
  openTransientOverlay: PivotTransientOverlay;
  /** Last dismissal reason, useful for dev/test readback */
  lastOverlayDismissReason: PivotOverlayDismissReason | null;
  /** Reserved width for the pivot field panel when editing is active */
  fieldPanelWidth: number;
  /** Initial source range from selection (e.g., "A1:D10") */
  initialSourceRange: string;

  // Location selection state
  /** Whether to place pivot on new or existing worksheet */
  locationMode: PivotLocationMode;
  /** Sheet ID for existing worksheet option (null when using new worksheet) */
  destinationSheetId: string | null;
  /** Cell reference for output location (e.g., "A1") - without sheet prefix */
  destinationCellRef: string;
  /** Stable creation dialog session for dialog hosts/harness receipts */
  dialogSession: PivotDialogSession | null;
}

export interface PivotDialogSlice {
  pivot: PivotUIState;
  openPivotDialog: (sourceRange?: string) => void;
  closePivotDialog: () => void;
  getPivotDialogSession: () => PivotDialogSession | null;
  updatePivotDialogDraft: (draft: Partial<Omit<PivotDialogDraft, 'sessionId'>>) => void;
  selectPivot: (pivotId: string | null) => void;
  startEditingPivot: (pivotId: string) => void;
  stopEditingPivot: () => void;
  openPivotOverlay: (overlay: Exclude<PivotTransientOverlay, null>) => void;
  closePivotOverlays: (reason: PivotOverlayDismissReason) => void;
  setPivotFieldPanelWidth: (width: number) => void;
  // Location selection actions
  setLocationMode: (mode: PivotLocationMode) => void;
  setDestinationSheet: (sheetId: string | null) => void;
  setDestinationCell: (cellRef: string) => void;
}

const initialState: PivotUIState = {
  isDialogOpen: false,
  selectedPivotId: null,
  editingPivotId: null,
  fieldPanelSuppressedPivotId: null,
  openTransientOverlay: null,
  lastOverlayDismissReason: null,
  fieldPanelWidth: DEFAULT_PIVOT_FIELD_PANEL_WIDTH,
  initialSourceRange: '',
  // Location selection defaults
  locationMode: 'newWorksheet',
  destinationSheetId: null,
  destinationCellRef: 'A1',
  dialogSession: null,
};

function createSessionId(): string {
  return `pivot-dialog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampPanelWidth(width: number): number {
  return Math.min(
    MAX_PIVOT_FIELD_PANEL_WIDTH,
    Math.max(MIN_PIVOT_FIELD_PANEL_WIDTH, Math.round(width)),
  );
}

export const createPivotDialogSlice: StateCreator<PivotDialogSlice, [], [], PivotDialogSlice> = (
  set,
  get,
) => ({
  pivot: initialState,

  openPivotDialog: (sourceRange?: string) => {
    const sessionId = createSessionId();
    const source = sourceRange ?? '';
    set((s) => ({
      pivot: {
        ...s.pivot,
        isDialogOpen: true,
        initialSourceRange: source,
        dialogSession: {
          sessionId,
          openedAt: Date.now(),
          hostId: 'create-pivot-dialog',
          draft: {
            sessionId,
            sourceRange: source,
            name: 'PivotTable1',
            locationMode: s.pivot.locationMode,
            destinationSheetId: s.pivot.destinationSheetId,
            destinationCellRef: s.pivot.destinationCellRef,
          },
        },
      },
    }));
  },

  closePivotDialog: () => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        isDialogOpen: false,
        initialSourceRange: '',
        // Reset location state to defaults on dialog close
        locationMode: 'newWorksheet',
        destinationSheetId: null,
        destinationCellRef: 'A1',
        dialogSession: null,
      },
    }));
  },

  getPivotDialogSession: () => get().pivot.dialogSession,

  updatePivotDialogDraft: (draft) => {
    set((s) => {
      if (!s.pivot.dialogSession) return s;
      return {
        pivot: {
          ...s.pivot,
          dialogSession: {
            ...s.pivot.dialogSession,
            draft: {
              ...s.pivot.dialogSession.draft,
              ...draft,
              sessionId: s.pivot.dialogSession.sessionId,
            },
          },
        },
      };
    });
  },

  selectPivot: (pivotId: string | null) => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        selectedPivotId: pivotId,
        editingPivotId:
          pivotId == null || (s.pivot.editingPivotId != null && s.pivot.editingPivotId !== pivotId)
            ? null
            : s.pivot.editingPivotId,
        fieldPanelSuppressedPivotId:
          pivotId == null || s.pivot.fieldPanelSuppressedPivotId !== pivotId
            ? null
            : s.pivot.fieldPanelSuppressedPivotId,
        openTransientOverlay: null,
        lastOverlayDismissReason:
          s.pivot.openTransientOverlay != null
            ? 'selection-change'
            : s.pivot.lastOverlayDismissReason,
      },
    }));
  },

  startEditingPivot: (pivotId: string) => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        selectedPivotId: pivotId,
        editingPivotId: pivotId,
        fieldPanelSuppressedPivotId: null,
        openTransientOverlay: null,
        lastOverlayDismissReason:
          s.pivot.openTransientOverlay != null ? 'panel-open' : s.pivot.lastOverlayDismissReason,
      },
    }));
  },

  stopEditingPivot: () => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        editingPivotId: null,
        fieldPanelSuppressedPivotId: s.pivot.editingPivotId ?? s.pivot.selectedPivotId,
      },
    }));
  },

  openPivotOverlay: (overlay: Exclude<PivotTransientOverlay, null>) => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        selectedPivotId: overlay.pivotId,
        editingPivotId:
          s.pivot.editingPivotId != null && s.pivot.editingPivotId !== overlay.pivotId
            ? null
            : s.pivot.editingPivotId,
        fieldPanelSuppressedPivotId: null,
        openTransientOverlay: overlay,
        lastOverlayDismissReason: null,
      },
    }));
  },

  closePivotOverlays: (reason: PivotOverlayDismissReason) => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        openTransientOverlay: null,
        lastOverlayDismissReason:
          s.pivot.openTransientOverlay != null ? reason : s.pivot.lastOverlayDismissReason,
      },
    }));
  },

  setPivotFieldPanelWidth: (width: number) => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        fieldPanelWidth: clampPanelWidth(width),
      },
    }));
  },

  setLocationMode: (mode: PivotLocationMode) => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        locationMode: mode,
        dialogSession: s.pivot.dialogSession
          ? {
              ...s.pivot.dialogSession,
              draft: {
                ...s.pivot.dialogSession.draft,
                locationMode: mode,
              },
            }
          : null,
      },
    }));
  },

  setDestinationSheet: (sheetId: string | null) => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        destinationSheetId: sheetId,
        dialogSession: s.pivot.dialogSession
          ? {
              ...s.pivot.dialogSession,
              draft: {
                ...s.pivot.dialogSession.draft,
                destinationSheetId: sheetId,
              },
            }
          : null,
      },
    }));
  },

  setDestinationCell: (cellRef: string) => {
    set((s) => ({
      pivot: {
        ...s.pivot,
        destinationCellRef: cellRef,
        dialogSession: s.pivot.dialogSession
          ? {
              ...s.pivot.dialogSession,
              draft: {
                ...s.pivot.dialogSession.draft,
                destinationCellRef: cellRef,
              },
            }
          : null,
      },
    }));
  },
});
