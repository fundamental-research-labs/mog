/**
 * Equation Dialog Slice
 *
 * Manages state for the Equation Editor dialog.
 * Handles equation input, template selection, and preview state.
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Equation template category
 */
export type EquationTemplateCategory =
  | 'recent'
  | 'basic'
  | 'algebra'
  | 'calculus'
  | 'statistics'
  | 'greek';

/**
 * Equation template definition
 */
export interface EquationTemplate {
  /** Unique template ID */
  id: string;
  /** Display name */
  name: string;
  /** LaTeX representation */
  latex: string;
  /** Category for grouping */
  category: EquationTemplateCategory;
  /** Preview image URL (optional, for complex equations) */
  previewUrl?: string;
}

/**
 * Equation dialog state
 */
export interface EquationDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current LaTeX input */
  latex: string;
  /** Selected template category */
  selectedCategory: EquationTemplateCategory;
  /** ID of equation being edited (null for new equations) */
  editingEquationId: string | null;
  /** Row of the cell where equation will be inserted */
  targetRow: number;
  /** Column of the cell where equation will be inserted */
  targetCol: number;
  /** Whether the preview is loading */
  isPreviewLoading: boolean;
  /** Preview error message if any */
  previewError: string | null;
  /** Recently used templates (persisted across sessions) */
  recentTemplates: string[];
}

/**
 * Equation dialog slice actions and state
 */
export interface EquationDialogSlice {
  /** Dialog state */
  equationDialog: EquationDialogState;

  // Actions
  /** Open the equation dialog for inserting a new equation */
  openEquationDialog: (row: number, col: number) => void;
  /** Open the equation dialog for editing an existing equation */
  openEquationDialogForEdit: (equationId: string, row: number, col: number, latex: string) => void;
  /** Close the equation dialog */
  closeEquationDialog: () => void;
  /** Update the LaTeX input */
  setEquationLatex: (latex: string) => void;
  /** Set the selected template category */
  setEquationCategory: (category: EquationTemplateCategory) => void;
  /** Apply a template to the LaTeX input */
  applyEquationTemplate: (template: EquationTemplate) => void;
  /** Set preview loading state */
  setEquationPreviewLoading: (loading: boolean) => void;
  /** Set preview error */
  setEquationPreviewError: (error: string | null) => void;
  /** Add a template to recent history */
  addRecentEquationTemplate: (templateId: string) => void;
  /** Clear recent templates */
  clearRecentEquationTemplates: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialEquationDialog: EquationDialogState = {
  isOpen: false,
  latex: '',
  selectedCategory: 'basic',
  editingEquationId: null,
  targetRow: 0,
  targetCol: 0,
  isPreviewLoading: false,
  previewError: null,
  recentTemplates: [],
};

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of recent templates to track */
const MAX_RECENT_TEMPLATES = 10;

// =============================================================================
// Slice Creator
// =============================================================================

export const createEquationDialogSlice: StateCreator<
  EquationDialogSlice,
  [],
  [],
  EquationDialogSlice
> = (set) => ({
  equationDialog: initialEquationDialog,

  openEquationDialog: (row: number, col: number) => {
    set({
      equationDialog: {
        ...initialEquationDialog,
        isOpen: true,
        targetRow: row,
        targetCol: col,
      },
    });
  },

  openEquationDialogForEdit: (equationId: string, row: number, col: number, latex: string) => {
    set({
      equationDialog: {
        ...initialEquationDialog,
        isOpen: true,
        editingEquationId: equationId,
        targetRow: row,
        targetCol: col,
        latex,
      },
    });
  },

  closeEquationDialog: () => {
    set((state) => ({
      equationDialog: {
        ...initialEquationDialog,
        // Preserve recent templates across dialog sessions
        recentTemplates: state.equationDialog.recentTemplates,
      },
    }));
  },

  setEquationLatex: (latex: string) => {
    set((state) => ({
      equationDialog: {
        ...state.equationDialog,
        latex,
        previewError: null,
      },
    }));
  },

  setEquationCategory: (category: EquationTemplateCategory) => {
    set((state) => ({
      equationDialog: {
        ...state.equationDialog,
        selectedCategory: category,
      },
    }));
  },

  applyEquationTemplate: (template: EquationTemplate) => {
    set((state) => ({
      equationDialog: {
        ...state.equationDialog,
        latex: template.latex,
        previewError: null,
      },
    }));
  },

  setEquationPreviewLoading: (loading: boolean) => {
    set((state) => ({
      equationDialog: {
        ...state.equationDialog,
        isPreviewLoading: loading,
      },
    }));
  },

  setEquationPreviewError: (error: string | null) => {
    set((state) => ({
      equationDialog: {
        ...state.equationDialog,
        previewError: error,
        isPreviewLoading: false,
      },
    }));
  },

  addRecentEquationTemplate: (templateId: string) => {
    set((state) => {
      const recentTemplates = state.equationDialog.recentTemplates.filter(
        (id) => id !== templateId,
      );
      recentTemplates.unshift(templateId);

      return {
        equationDialog: {
          ...state.equationDialog,
          recentTemplates: recentTemplates.slice(0, MAX_RECENT_TEMPLATES),
        },
      };
    });
  },

  clearRecentEquationTemplates: () => {
    set((state) => ({
      equationDialog: {
        ...state.equationDialog,
        recentTemplates: [],
      },
    }));
  },
});
