/**
 * Editor Commit Coordination
 *
 * Coordinates editor state transitions with validation and execution.
 * Observes editor machine to handle validation and commit lifecycle.
 */

import { sheetId as toSheetId, type CellRange, type SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { EditorActor, EditorState, SelectionActor } from './cross-coordination';
import { requestFormulaBarRefresh } from '../../../infra/events/formula-bar-refresh';

// =============================================================================
// EDITOR → YJS COORDINATION
// =============================================================================

/**
 * Information passed when editor is ready to commit.
 * The coordinator uses this to call the execution layer.
 */
export interface EditorCommittingInfo {
  /** The cell being edited (from selection.activeCell - single source of truth) */
  cell: CellCoord;
  /** The sheet ID where the edit is occurring */
  sheetId: string;
  /** The value to commit */
  value: string;
  /** Whether this is an array formula (CSE - Ctrl+Shift+Enter) */
  isArrayFormula?: boolean;
  /**
   * Selection range for CSE array formulas.
   * When isArrayFormula is true, this range defines the CSE output area.
   */
  selectionRange?: CellRange;
}

/**
 * Validation result for editor commit.
 * Used by the coordinator to determine whether to proceed with commit.
 */
export interface EditorValidationResult {
  /** Whether the value is valid */
  valid: boolean;
  /** Error message if invalid */
  errorMessage?: string;
  /** Error title (for dialog display) */
  errorTitle?: string;
  /** Enforcement level determines UI behavior */
  enforcement: 'strict' | 'warning' | 'info' | 'none';
}

/**
 * Callback to validate a value against the cell's schema.
 * Returns validation result including enforcement behavior.
 */
export type ValidateCellValueCallback = (
  sheetId: SheetId,
  row: number,
  col: number,
  value: string,
) => Promise<EditorValidationResult | null>;

/**
 * Direct circular-reference validation result for an interactive formula commit.
 */
export interface CircularReferenceValidationResult {
  /** Display address of the cell being edited (for dialog display). */
  cellAddress: string;
  /** Authored formula text that would create the direct self-reference. */
  formula: string;
}

/**
 * Callback to validate whether a formula directly references the edited cell
 * while iterative calculation is disabled.
 */
export type ValidateCircularReferenceCallback = (
  sheetId: SheetId,
  row: number,
  col: number,
  formula: string,
) => Promise<CircularReferenceValidationResult | null>;

const SIGNED_NUMERIC_LITERAL_RE = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?%?$/;

/**
 * Excel lets users begin formula entry with `=`, `+`, or `-`, but a completed
 * signed numeric literal such as `-300` is still a scalar value, not a formula
 * syntax error. The Rust set-cell classifier already treats only leading `=`
 * as formula source, so commit pre-validation must not reject signed numbers
 * before they reach that production classifier.
 */
function shouldValidateFormulaSyntax(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  const firstChar = trimmed.charAt(0);
  if (firstChar !== '=' && firstChar !== '+' && firstChar !== '-') return false;
  return !SIGNED_NUMERIC_LITERAL_RE.test(trimmed);
}

function shouldValidateCircularReference(value: string): boolean {
  return value.trimStart().startsWith('=');
}

/**
 * G.2: Formula syntax validation result with optional error position.
 * Supports both legacy format (string only) and new format with position.
 *
 */
export interface FormulaSyntaxError {
  /** The error message to display to the user */
  errorMessage: string;
  /** Optional character index where the error occurred (0-based) */
  errorPosition?: number;
}

/**
 * Result type for formula syntax validation.
 * - null: formula is valid
 * - string: legacy format, error message only
 * - FormulaSyntaxError: new format with optional error position
 */
export type FormulaSyntaxValidationResult = string | FormulaSyntaxError | null;

/**
 * Configuration for Editor-Yjs coordination.
 *
 * NOTE: This is the COORDINATION layer - it only observes state and signals.
 * Actual Yjs writes happen in editor-execution.ts.
 *
 * @see ISSUE-12-COORDINATOR-ANTIPATTERNS.md - Anti-Pattern 1
 */
export interface EditorCommitCoordinationConfig {
  editorActor: EditorActor;
  /**
   * Selection actor - needed to derive editingCell from selection.activeCell
   * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
   */
  selectionActor: SelectionActor;
  /**
   * Optional callback to validate cell value before commit.
   * If not provided, validation is skipped (auto-success).
   */
  validateCellValue?: ValidateCellValueCallback;
  /**
   * Optional callback to detect direct circular references before commit.
   * Runs after formula syntax validation and before data validation.
   */
  validateCircularReference?: ValidateCircularReferenceCallback;
  /**
   * Optional callback for strict enforcement - called when validation fails
   * with 'strict' enforcement (blocks entry).
   * Shows error dialog with Retry (return to edit) and Cancel (discard) options.
   * If not provided, just blocks entry silently.
   */
  onValidationError?: (
    message: string,
    title: string,
    onRetry: () => void,
    onCancel: () => void,
  ) => void;
  /**
   * Optional callback for warning enforcement - called when validation fails
   * with 'warning' enforcement and user needs to confirm.
   * If provided, coordinator calls this and waits for user decision.
   * If not provided, warning enforcement is treated as 'info' (allow).
   *
   * Added onRetry callback for "No" button (return to edit mode).
   */
  onValidationWarning?: (
    message: string,
    title: string,
    onProceed: () => void,
    onCancel: () => void,
    onRetry: () => void,
  ) => void;
  /**
   * Optional callback for info enforcement - called when validation fails
   * with 'info' enforcement. Two-button dialog (OK / Cancel):
   * - OK: commit the value (VALIDATION_SUCCESS)
   * - Cancel: discard the edit (CANCEL)
   * If not provided, info enforcement silently allows entry.
   */
  onValidationInformation?: (
    message: string,
    title: string,
    onProceed: () => void,
    onCancel: () => void,
  ) => void;
  /**
   * Optional callback for formula syntax errors.
   * Called when a formula cannot be parsed. User can:
   * - Edit: return to editing state to fix the formula
   * - Accept as text: commit the formula text as a literal string (not executed)
   *
   * G.2: Now includes optional errorPosition for cursor positioning.
   *
   */
  onFormulaError?: (
    formula: string,
    errorMessage: string,
    onEdit: () => void,
    onAcceptAsText: () => void,
    onCancel: () => void,
    /** G.2: Optional error position for cursor placement (0-based character index) */
    errorPosition?: number,
  ) => void;
  /**
   * Optional callback for direct circular-reference warnings.
   * Circular warnings are non-blocking: the edit commits immediately while the
   * host decides whether to enable iterative calculation.
   */
  onCircularReferenceWarning?: (
    cellAddress: string,
    formula: string,
    onEnableIterative: () => void,
    onCancel: () => void,
  ) => void;
  /**
   * Optional callback to validate formula syntax.
   * Returns null if valid, or error message/object if invalid.
   * If not provided, formula validation is skipped.
   *
   * G.2: Can return an object with errorPosition for cursor placement.
   *
   */
  validateFormulaSyntax?: (
    sheetId: SheetId,
    formula: string,
    row: number,
    col: number,
  ) => FormulaSyntaxValidationResult | Promise<FormulaSyntaxValidationResult>;
}

/**
 * Set up editor validation coordination.
 *
 * This handles the VALIDATION aspect of the commit pipeline:
 * - Observes editor state transitions
 * - Validates cell value against schema (if validateCellValue callback provided)
 * - Validates formula syntax (if validateFormulaSyntax callback provided)
 * - Sends machine events (VALIDATION_SUCCESS, VALIDATION_ERROR)
 *
 * The actual cell write is handled by the editor machine's `commitCellValue` invoke.
 * The machine awaits the bridge promise in `committing` state and transitions
 * via onDone/onError. No COMMIT_COMPLETE dispatch needed.
 *
 * Flow:
 * 1. User commits edit → editor enters `validating` state
 * 2. This coordination validates via validateCellValue callback
 * 3. Based on validation result and enforcement level:
 * - Valid or no schema: VALIDATION_SUCCESS → committing
 * - Invalid + strict: VALIDATION_ERROR → error state (blocks entry)
 * - Invalid + warning: onValidationWarning callback → user decides
 * - Invalid + info/none: VALIDATION_SUCCESS → committing (allows entry)
 * 4. Editor enters `committing` state → invoke handles the bridge call
 *
 * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
 * @see ISSUE-12-COORDINATOR-ANTIPATTERNS.md - Anti-Pattern 1 fix
 */
export function setupEditorCommitCoordination(config: EditorCommitCoordinationConfig): () => void {
  const {
    editorActor,
    selectionActor,
    validateCellValue,
    validateCircularReference,
    onValidationError,
    onValidationWarning,
    onValidationInformation,
    onFormulaError,
    onCircularReferenceWarning,
    validateFormulaSyntax,
  } = config;
  let previousState: EditorState | null = null;

  const subscription = editorActor.subscribe((state) => {
    const wasEditing =
      previousState?.matches('editing') ||
      previousState?.matches('formulaEditing') ||
      previousState?.matches('richTextEditing') ||
      previousState?.matches('imeComposing');
    const isValidating = state.matches('validating');
    const didCommit = previousState?.matches('committing') && state.matches('inactive');
    if (didCommit) {
      const sheetId = previousState?.context.sheetId;
      const editingCell = previousState?.context.editingCell;
      if (sheetId && editingCell) {
        requestFormulaBarRefresh({
          sheetIds: [toSheetId(sheetId)],
          ranges: [
            {
              startRow: editingCell.row,
              startCol: editingCell.col,
              endRow: editingCell.row,
              endCol: editingCell.col,
            },
          ],
        });
      }
    }

    // Entering validating → run validation
    if (wasEditing && isValidating) {
      previousState = state;

      const { value, sheetId, editingCell: editorEditingCell } = state.context;
      // Use editingCell from editor context (set once at START_EDITING, stable during point mode).
      // Falls back to selection.activeCell for backward compatibility.
      const editingCell = editorEditingCell ?? selectionActor.getSnapshot().context.activeCell;

      // No cell or sheet - can't validate, just proceed
      if (!editingCell || !sheetId) {
        editorActor.send({ type: 'VALIDATION_SUCCESS' });
        return;
      }

      // Formula syntax validation and data validation both go through async
      // production dependencies. Formula syntax runs first so malformed
      // formulas never reach the cell mutation path.
      void (async () => {
        if (
          !state.context.formulaInputIsLiteral &&
          shouldValidateFormulaSyntax(value) &&
          validateFormulaSyntax
        ) {
          const syntaxResult = await validateFormulaSyntax(
            toSheetId(sheetId),
            value,
            editingCell.row,
            editingCell.col,
          );
          if (syntaxResult) {
            // G.2: Handle both legacy string format and new object format
            const errorMessage =
              typeof syntaxResult === 'string' ? syntaxResult : syntaxResult.errorMessage;
            const errorPosition =
              typeof syntaxResult === 'string' ? undefined : syntaxResult.errorPosition;

            // Formula has syntax error
            // First, transition to error state (which supports RETRY)
            editorActor.send({ type: 'VALIDATION_ERROR', message: errorMessage });

            if (onFormulaError) {
              // Show formula error dialog and wait for user decision
              // Note: Machine is now in 'error' state, which supports RETRY
              onFormulaError(
                value,
                errorMessage,
                // onEdit: return to editing state to fix the formula
                // Uses RETRY event which goes from 'error' back to 'editing' or 'formulaEditing'
                // G.2: If errorPosition provided, cursor will be placed there
                () => {
                  editorActor.send({ type: 'RETRY' });
                  // G.2: Set cursor to error position if provided
                  if (errorPosition !== undefined) {
                    editorActor.send({ type: 'SET_CURSOR', position: errorPosition });
                  }
                },
                // onAcceptAsText: commit the formula as literal text (prefix with apostrophe)
                () => {
                  // From error state, first go back to editing
                  editorActor.send({ type: 'RETRY' });
                  // Then modify the value in context to be text (prefix with apostrophe)
                  // Programmatic mutation — there is no live DOM caret to
                  // preserve, so end-of-value is the correct cursor.
                  {
                    const prefixed = "'" + value;
                    editorActor.send({
                      type: 'INPUT',
                      value: prefixed,
                      cursorPosition: prefixed.length,
                    });
                  }
                  // Finally, commit the text value (no longer a formula, starts with apostrophe)
                  editorActor.send({
                    type: 'COMMIT',
                    direction: state.context.commitDirection || 'none',
                  });
                },
                () => {
                  editorActor.send({ type: 'CANCEL' });
                },
                // G.2: Pass error position to dialog for potential UI use
                errorPosition,
              );
            }
            return;
          }
        }

        if (
          !state.context.formulaInputIsLiteral &&
          shouldValidateCircularReference(value) &&
          validateCircularReference
        ) {
          const circularReferenceResult = await validateCircularReference(
            toSheetId(sheetId),
            editingCell.row,
            editingCell.col,
            value,
          );

          if (circularReferenceResult) {
            if (onCircularReferenceWarning) {
              onCircularReferenceWarning(
                circularReferenceResult.cellAddress,
                circularReferenceResult.formula,
                () => undefined,
                () => undefined,
              );
            }
            editorActor.send({ type: 'VALIDATION_SUCCESS' });
            return;
          }
        }

        // No data validation callback provided - auto-succeed (backward compatible)
        if (!validateCellValue) {
          editorActor.send({ type: 'VALIDATION_SUCCESS' });
          return;
        }

        const validationResult = await validateCellValue(
          toSheetId(sheetId),
          editingCell.row,
          editingCell.col,
          value,
        );

        // No schema for this cell - auto-succeed
        if (!validationResult) {
          editorActor.send({ type: 'VALIDATION_SUCCESS' });
          return;
        }

        // Valid value - proceed
        if (validationResult.valid) {
          editorActor.send({ type: 'VALIDATION_SUCCESS' });
          return;
        }

        // Invalid value - handle based on enforcement level
        const errorMessage = validationResult.errorMessage || 'Invalid value';
        const errorTitle = validationResult.errorTitle || 'Validation Error';

        switch (validationResult.enforcement) {
          case 'strict':
            // Block entry - send error event to machine and show dialog
            editorActor.send({ type: 'VALIDATION_ERROR', message: errorMessage });
            if (onValidationError) {
              onValidationError(
                errorMessage,
                errorTitle,
                () => editorActor.send({ type: 'RETRY_SELECT_ALL' }), // Retry selects rejected text
                () => editorActor.send({ type: 'CANCEL' }), // User chose "Cancel" - discard edit
              );
            }
            break;

          case 'warning':
            // Show warning dialog - let user decide
            // Three-button dialog (Yes/No/Cancel)
            if (onValidationWarning) {
              onValidationWarning(
                errorMessage,
                errorTitle,
                () => editorActor.send({ type: 'VALIDATION_SUCCESS' }), // User chose "Yes" - proceed with invalid value
                () => editorActor.send({ type: 'CANCEL' }), // User chose "Cancel" - exit editing, revert to original
                () => editorActor.send({ type: 'RETRY_SELECT_ALL' }), // No selects rejected text
              );
            } else {
              // No warning handler - treat as info (allow)
              editorActor.send({ type: 'VALIDATION_SUCCESS' });
            }
            break;

          case 'info':
            // Show informational dialog - user confirms or cancels
            if (onValidationInformation) {
              onValidationInformation(
                errorMessage,
                errorTitle,
                () => editorActor.send({ type: 'VALIDATION_SUCCESS' }), // OK - commit value
                () => editorActor.send({ type: 'CANCEL' }), // Cancel - revert
              );
            } else {
              editorActor.send({ type: 'VALIDATION_SUCCESS' });
            }
            break;

          case 'none':
            // Allow entry - just proceed
            editorActor.send({ type: 'VALIDATION_SUCCESS' });
            break;
        }
      })();

      return;
    }

    // Commit handling is now owned by the editor machine's `commitCellValue` invoke.
    // The machine awaits the bridge promise in `committing` and transitions via onDone/onError.
    // No COMMIT_COMPLETE dispatch needed — the invoke handles the lifecycle.

    previousState = state;
  });

  return () => subscription.unsubscribe();
}
