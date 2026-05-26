/**
 * Evaluate Formula Dialog Slice
 *
 * Manages state for the Evaluate Formula dialog, which allows users
 * to step through formula evaluation to understand how Excel calculates
 * the result.
 *
 * Features:
 * - Step-through formula evaluation
 * - Show intermediate values
 * - Step In/Step Out buttons for nested formulas
 * - Highlight current expression being evaluated
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * A step in formula evaluation
 */
export interface EvaluationStep {
  /** The expression being evaluated */
  expression: string;
  /** The result of this step */
  result: unknown;
  /** Human-readable description of this step */
  description: string;
  /** Whether this step has sub-steps (can step into) */
  hasSubSteps: boolean;
  /** Depth in the evaluation tree (0 = top level) */
  depth: number;
}

/**
 * Evaluate Formula dialog state
 */
export interface EvaluateFormulaDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Sheet ID of the cell being evaluated */
  sheetId: string | null;
  /** Row of the cell being evaluated */
  row: number;
  /** Column of the cell being evaluated */
  col: number;
  /** Cell reference string (e.g., "A1") */
  cellRef: string;
  /** The original formula */
  originalFormula: string;
  /** Current formula with parts replaced by evaluated values */
  currentFormula: string;
  /** All evaluation steps */
  steps: EvaluationStep[];
  /** Current step index */
  currentStepIndex: number;
  /** Current evaluation depth (for Step In/Out) */
  currentDepth: number;
  /** Whether evaluation is complete */
  isComplete: boolean;
  /** The final result */
  finalResult: unknown;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface EvaluateFormulaDialogSlice {
  /** Evaluate Formula dialog state */
  evaluateFormulaDialog: EvaluateFormulaDialogState;

  /** Open the Evaluate Formula dialog for a cell */
  openEvaluateFormulaDialog: (config: {
    sheetId: string;
    row: number;
    col: number;
    cellRef: string;
    formula: string;
  }) => void;

  /** Close the Evaluate Formula dialog */
  closeEvaluateFormulaDialog: () => void;

  /** Set the evaluation steps */
  setEvaluationSteps: (steps: EvaluationStep[]) => void;

  /** Step to the next evaluation */
  evaluateNext: () => void;

  /** Step into a nested expression */
  stepInto: () => void;

  /** Step out of nested expression */
  stepOut: () => void;

  /** Restart evaluation from the beginning */
  restartEvaluation: () => void;

  /** Update the current formula display */
  updateCurrentFormula: (formula: string) => void;

  /** Set the final result */
  setFinalResult: (result: unknown) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialEvaluateFormulaDialogState: EvaluateFormulaDialogState = {
  isOpen: false,
  sheetId: null,
  row: 0,
  col: 0,
  cellRef: '',
  originalFormula: '',
  currentFormula: '',
  steps: [],
  currentStepIndex: -1,
  currentDepth: 0,
  isComplete: false,
  finalResult: undefined,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createEvaluateFormulaDialogSlice: StateCreator<
  EvaluateFormulaDialogSlice,
  [],
  [],
  EvaluateFormulaDialogSlice
> = (set, get) => ({
  evaluateFormulaDialog: initialEvaluateFormulaDialogState,

  openEvaluateFormulaDialog: (config) => {
    set({
      evaluateFormulaDialog: {
        ...initialEvaluateFormulaDialogState,
        isOpen: true,
        sheetId: config.sheetId,
        row: config.row,
        col: config.col,
        cellRef: config.cellRef,
        originalFormula: config.formula,
        currentFormula: config.formula,
      },
    });
  },

  closeEvaluateFormulaDialog: () => {
    set({
      evaluateFormulaDialog: initialEvaluateFormulaDialogState,
    });
  },

  setEvaluationSteps: (steps) => {
    set((state) => ({
      evaluateFormulaDialog: {
        ...state.evaluateFormulaDialog,
        steps,
        currentStepIndex: steps.length > 0 ? 0 : -1,
      },
    }));
  },

  evaluateNext: () => {
    const state = get().evaluateFormulaDialog;
    const nextIndex = state.currentStepIndex + 1;

    // Find next step at same or higher level (shallower depth)
    let targetIndex = nextIndex;
    while (
      targetIndex < state.steps.length &&
      state.steps[targetIndex].depth > state.currentDepth
    ) {
      targetIndex++;
    }

    if (targetIndex >= state.steps.length) {
      // Evaluation complete
      set({
        evaluateFormulaDialog: {
          ...state,
          isComplete: true,
        },
      });
    } else {
      const step = state.steps[targetIndex];
      set({
        evaluateFormulaDialog: {
          ...state,
          currentStepIndex: targetIndex,
          currentFormula: step.expression,
        },
      });
    }
  },

  stepInto: () => {
    const state = get().evaluateFormulaDialog;
    const currentStep = state.steps[state.currentStepIndex];

    if (!currentStep?.hasSubSteps) return;

    // Find first sub-step (next step with deeper depth)
    const nextIndex = state.currentStepIndex + 1;
    if (nextIndex < state.steps.length && state.steps[nextIndex].depth > currentStep.depth) {
      set({
        evaluateFormulaDialog: {
          ...state,
          currentStepIndex: nextIndex,
          currentDepth: state.steps[nextIndex].depth,
          currentFormula: state.steps[nextIndex].expression,
        },
      });
    }
  },

  stepOut: () => {
    const state = get().evaluateFormulaDialog;

    if (state.currentDepth === 0) return;

    // Find next step at parent level (shallower depth)
    const targetDepth = state.currentDepth - 1;
    let targetIndex = state.currentStepIndex + 1;

    while (targetIndex < state.steps.length && state.steps[targetIndex].depth > targetDepth) {
      targetIndex++;
    }

    if (targetIndex < state.steps.length) {
      set({
        evaluateFormulaDialog: {
          ...state,
          currentStepIndex: targetIndex,
          currentDepth: targetDepth,
          currentFormula: state.steps[targetIndex].expression,
        },
      });
    } else {
      // Return to top level
      set({
        evaluateFormulaDialog: {
          ...state,
          currentDepth: 0,
          isComplete: true,
        },
      });
    }
  },

  restartEvaluation: () => {
    const state = get().evaluateFormulaDialog;
    set({
      evaluateFormulaDialog: {
        ...state,
        currentStepIndex: state.steps.length > 0 ? 0 : -1,
        currentDepth: 0,
        currentFormula: state.originalFormula,
        isComplete: false,
        finalResult: undefined,
      },
    });
  },

  updateCurrentFormula: (formula) => {
    set((state) => ({
      evaluateFormulaDialog: {
        ...state.evaluateFormulaDialog,
        currentFormula: formula,
      },
    }));
  },

  setFinalResult: (result) => {
    set((state) => ({
      evaluateFormulaDialog: {
        ...state.evaluateFormulaDialog,
        finalResult: result,
        isComplete: true,
      },
    }));
  },
});
