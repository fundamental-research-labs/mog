/**
 * Goal Seek Dialog Slice
 *
 * Manages state for the Goal Seek dialog, which finds the input value
 * needed to produce a desired result in a formula.
 *
 * Goal Seek solves for an unknown value in a formula by iteratively
 * adjusting a changing cell until the formula produces the target value.
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Goal Seek algorithm status
 */
export type GoalSeekStatus = 'idle' | 'running' | 'completed' | 'failed';

/**
 * Goal Seek result information
 */
export interface GoalSeekResult {
  /** Whether a solution was found */
  found: boolean;
  /** The value that achieves the target (when found) */
  solutionValue?: number;
  /** The actual result achieved (may differ slightly from target) */
  achievedValue?: number;
  /** Number of iterations performed */
  iterations: number;
  /** Error message (when failed) */
  errorMessage?: string;
}

/**
 * Goal Seek dialog state
 */
export interface GoalSeekDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Set cell reference (the formula cell to achieve target) */
  setCell: string;
  /** Target value to achieve */
  toValue: string;
  /** By changing cell reference (the input cell to adjust) */
  byChangingCell: string;
  /** Current algorithm status */
  status: GoalSeekStatus;
  /** Result of the last Goal Seek run */
  result: GoalSeekResult | null;
  /** Maximum iterations for algorithm */
  maxIterations: number;
  /** Precision threshold for convergence */
  precision: number;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface GoalSeekDialogSlice {
  /** Goal Seek dialog state */
  goalSeekDialog: GoalSeekDialogState;

  /** Open the Goal Seek dialog */
  openGoalSeekDialog: (initial?: Partial<Pick<GoalSeekDialogState, 'setCell'>>) => void;

  /** Close the Goal Seek dialog */
  closeGoalSeekDialog: () => void;

  /** Update set cell reference */
  setGoalSeekSetCell: (reference: string) => void;

  /** Update target value */
  setGoalSeekToValue: (value: string) => void;

  /** Update by changing cell reference */
  setGoalSeekByChangingCell: (reference: string) => void;

  /** Update algorithm status */
  setGoalSeekStatus: (status: GoalSeekStatus) => void;

  /** Set the result of Goal Seek calculation */
  setGoalSeekResult: (result: GoalSeekResult | null) => void;

  /** Reset Goal Seek state (keep dialog open but clear inputs) */
  resetGoalSeekState: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialGoalSeekDialogState: GoalSeekDialogState = {
  isOpen: false,
  setCell: '',
  toValue: '',
  byChangingCell: '',
  status: 'idle',
  result: null,
  maxIterations: 100,
  precision: 0.000001,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createGoalSeekDialogSlice: StateCreator<
  GoalSeekDialogSlice,
  [],
  [],
  GoalSeekDialogSlice
> = (set, _get) => ({
  goalSeekDialog: initialGoalSeekDialogState,

  openGoalSeekDialog: (initial) => {
    set({
      goalSeekDialog: {
        ...initialGoalSeekDialogState,
        ...initial,
        isOpen: true,
      },
    });
  },

  closeGoalSeekDialog: () => {
    set({
      goalSeekDialog: initialGoalSeekDialogState,
    });
  },

  setGoalSeekSetCell: (reference) => {
    set((state) => ({
      goalSeekDialog: {
        ...state.goalSeekDialog,
        setCell: reference,
      },
    }));
  },

  setGoalSeekToValue: (value) => {
    set((state) => ({
      goalSeekDialog: {
        ...state.goalSeekDialog,
        toValue: value,
      },
    }));
  },

  setGoalSeekByChangingCell: (reference) => {
    set((state) => ({
      goalSeekDialog: {
        ...state.goalSeekDialog,
        byChangingCell: reference,
      },
    }));
  },

  setGoalSeekStatus: (status) => {
    set((state) => ({
      goalSeekDialog: {
        ...state.goalSeekDialog,
        status,
      },
    }));
  },

  setGoalSeekResult: (result) => {
    set((state) => ({
      goalSeekDialog: {
        ...state.goalSeekDialog,
        result,
        status: result?.found ? 'completed' : result ? 'failed' : 'idle',
      },
    }));
  },

  resetGoalSeekState: () => {
    set((state) => ({
      goalSeekDialog: {
        ...initialGoalSeekDialogState,
        isOpen: state.goalSeekDialog.isOpen,
      },
    }));
  },
});
