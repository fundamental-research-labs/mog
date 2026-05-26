/**
 * Equation Action Handlers
 *
 * Pure handler functions for equation operations.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - Equation data mutations go through the unified Worksheet API (ws.addEquation, ws.updateEquation, ws.deleteFloatingObject)
 * - UI state (dialog) goes through the Equation Dialog slice
 * - Use deps.accessors for reading state where available
 *
 * This file handles:
 * - Equation lifecycle (insert, delete)
 * - Equation editing
 * - Dialog management
 *
 * Engine Integration - Action Handlers
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 1, 2, 17)
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { EquationConfig, MutationReceipt } from '@mog-sdk/contracts/api';

import { getUIStore, handled, notHandled } from './handler-utils';

/**
 * Get selected object IDs from the object interaction accessor.
 */
function getSelectedObjectIds(deps: ActionDependencies): string[] {
  return deps.accessors.object.getSelectedIds();
}

// =============================================================================
// Equation Lifecycle Actions
// =============================================================================

/**
 * INSERT_EQUATION - Open the equation editor dialog to insert a new equation.
 *
 * This handler:
 * 1. Gets the active cell position for equation placement
 * 2. Opens the equation dialog in "insert" mode
 *
 * The actual equation creation happens when the dialog is confirmed (via UPDATE_EQUATION).
 */
export const INSERT_EQUATION: ActionHandler = (deps): ActionResult => {
  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);

  // Get active cell for default placement
  const activeCell = deps.accessors.selection.getActiveCell();
  const row = activeCell?.row ?? 0;
  const col = activeCell?.col ?? 0;

  // Open dialog in "insert" mode
  uiStore.getState().openEquationDialog(row, col);

  return handled();
};

/**
 * EDIT_EQUATION - Open the equation editor dialog to edit an existing equation.
 *
 * Payload: { objectId: string }
 */
export const EDIT_EQUATION: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const objectId = payload?.objectId as string | undefined;

  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  // Get the equation object via the handle-based API
  const ws = deps.workbook.getSheetById(sheetId);
  const handle = await ws.equations.get(objectId);
  if (!handle) {
    return notHandled('wrong_context');
  }

  const obj = await handle.getData();
  if (obj.type !== 'equation') {
    return notHandled('wrong_context');
  }

  // For edit mode, row/col are only used to position the dialog initially.
  // Since we're editing an existing equation, we use defaults (0, 0) as the
  // equation's actual position is already stored in the object.
  const row = 0;
  const col = 0;

  // Get current LaTeX from equation
  const latex = obj.equation?.latex ?? '';

  // Open dialog in "edit" mode
  uiStore.getState().openEquationDialogForEdit(objectId, row, col, latex);

  return handled();
};

/**
 * UPDATE_EQUATION - Update an equation's content (called from dialog on save).
 *
 * Payload: {
 * objectId: string | null; // null for insert mode
 * latex: string;
 * omml?: string;
 * }
 */
export const UPDATE_EQUATION: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);

  const objectId = payload?.objectId as string | null;
  const latex = payload?.latex as string;
  const omml = payload?.omml as string | undefined;

  if (!latex) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(sheetId);

  if (objectId === null) {
    // Insert mode - create new equation
    const dialogState = uiStore.getState().equationDialog;
    const targetRow = dialogState?.targetRow ?? 0;
    const targetCol = dialogState?.targetCol ?? 0;

    const config: EquationConfig = {
      latex,
      anchorCell: { row: targetRow, col: targetCol },
      x: 0,
      y: 0,
      width: 150,
      height: 50,
    };

    try {
      deps.workbook.setPendingUndoDescription('Insert Equation');
      const handle = await ws.equations.add(config);

      // Select the newly created equation
      deps.commands.object.selectObject(handle.id, false, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to insert equation';
      console.error('Failed to insert equation:', message);
      return { handled: false, error: message };
    }
  } else {
    // Edit mode - update existing
    try {
      deps.workbook.setPendingUndoDescription('Edit Equation');
      const handle = await ws.equations.get(objectId);
      if (!handle) throw new Error(`Equation ${objectId} not found`);
      await handle.update({ latex, omml });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update equation';
      console.error('Failed to update equation:', message);
      return { handled: false, error: message };
    }
  }

  // Close the dialog
  uiStore.getState().closeEquationDialog();

  return handled();
};

/**
 * DELETE_EQUATION - Delete equation object(s).
 *
 * If objectId is provided in payload, deletes that specific object.
 * Otherwise, deletes all selected equation objects.
 *
 * Payload: { objectId?: string }
 */
export const DELETE_EQUATION: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  // Get object ID(s) to delete
  const objectId = payload?.objectId as string | undefined;
  const objectIds = objectId ? [objectId] : getSelectedObjectIds(deps);

  if (objectIds.length === 0) {
    return notHandled('wrong_context');
  }

  const ws = deps.workbook.getSheetById(sheetId);
  let deletedAny = false;
  const receipts: MutationReceipt[] = [];

  deps.workbook.setPendingUndoDescription('Delete Equation');
  for (const id of objectIds) {
    try {
      const handle = await ws.objects.get(id);
      if (handle) {
        const receipt = await handle.delete();
        receipts.push(receipt);
        deletedAny = true;
      }
    } catch (error) {
      console.error('Failed to delete equation:', (error as Error).message);
    }
  }

  if (!deletedAny) {
    return notHandled('wrong_context');
  }

  // Clear selection after deletion
  deps.commands.object.deselectAll();

  return handled(receipts.length > 0 ? { receipts } : undefined);
};

// =============================================================================
// Dialog Actions
// =============================================================================

/**
 * OPEN_EQUATION_DIALOG - Open equation dialog (generic).
 *
 * Payload: {
 * mode?: 'insert' | 'edit';
 * equationId?: string;
 * row?: number;
 * col?: number;
 * latex?: string;
 * }
 */
export const OPEN_EQUATION_DIALOG: ActionHandler = (deps, payload): ActionResult => {
  const uiStore = getUIStore(deps);

  const mode = (payload?.mode as 'insert' | 'edit') ?? 'insert';
  const equationId = payload?.equationId as string | undefined;
  const row = (payload?.row as number) ?? 0;
  const col = (payload?.col as number) ?? 0;
  const latex = (payload?.latex as string) ?? '';

  if (mode === 'edit' && equationId) {
    uiStore.getState().openEquationDialogForEdit(equationId, row, col, latex);
  } else {
    uiStore.getState().openEquationDialog(row, col);
  }

  return handled();
};

/**
 * CLOSE_EQUATION_DIALOG - Close equation dialog.
 */
export const CLOSE_EQUATION_DIALOG: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().closeEquationDialog();
  return handled();
};
