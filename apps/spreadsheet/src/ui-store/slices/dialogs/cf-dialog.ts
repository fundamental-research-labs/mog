/**
 * Conditional Formatting Dialog Slice
 *
 * Manages state for the conditional formatting dialog and its sub-dialogs.
 */

import type { StateCreator } from 'zustand';

import type { CFRuleType, ConditionalFormat } from '@mog-sdk/contracts/conditional-format';
import type { SheetId } from '@mog-sdk/contracts/core';

/**
 * Quick rule dialog types for highlight/top-bottom rules
 */
export type QuickRuleDialogType =
  | 'greaterThan'
  | 'lessThan'
  | 'between'
  | 'equalTo'
  | 'textContains'
  | 'duplicates'
  | 'dateOccurring'
  | 'blanks'
  | 'topItems'
  | 'bottomItems'
  | 'topPercent'
  | 'bottomPercent'
  | 'aboveAverage'
  | 'belowAverage'
  | null;

/**
 * Conditional formatting dialog state
 */
export interface CFDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current mode: 'create' or 'edit' */
  mode: 'create' | 'edit';
  /** Format being edited (for edit mode) */
  editingFormat: ConditionalFormat | null;
  /** Sheet that owns the format being edited */
  sourceSheetId: SheetId | null;
  /** Reopen the Rules Manager after the CF dialog closes */
  returnToRulesManager: boolean;
  /** Selected rule type for new rules */
  selectedRuleType: CFRuleType;
  /** Quick rule dialog type (for small focused dialogs) */
  quickRuleDialog: QuickRuleDialogType;
  /** Rules manager dialog open state */
  rulesManagerOpen: boolean;
}

export interface OpenCFDialogOptions {
  sheetId?: SheetId;
  returnToRulesManager?: boolean;
}

export interface CFDialogSlice {
  cfDialog: CFDialogState;
  openCFDialog: (
    mode?: 'create' | 'edit',
    format?: ConditionalFormat,
    options?: OpenCFDialogOptions,
  ) => void;
  closeCFDialog: () => void;
  setCFRuleType: (ruleType: CFRuleType) => void;
  openQuickRuleDialog: (type: QuickRuleDialogType) => void;
  closeQuickRuleDialog: () => void;
  openRulesManager: () => void;
  closeRulesManager: () => void;
  /**
   * 01 alias: matches the action name
   * `OPEN_CF_RULES_MANAGER` so handlers can call
   * `getUIStore(deps).getState().openCFRulesManager()` without a mental
   * indirection. Same target state (`cfDialog.rulesManagerOpen`).
   */
  openCFRulesManager: () => void;
  /** 01 alias for `closeRulesManager`. */
  closeCFRulesManager: () => void;
}

const initialState: CFDialogState = {
  isOpen: false,
  mode: 'create',
  editingFormat: null,
  sourceSheetId: null,
  returnToRulesManager: false,
  selectedRuleType: 'cellValue',
  quickRuleDialog: null,
  rulesManagerOpen: false,
};

export const createCFDialogSlice: StateCreator<CFDialogSlice, [], [], CFDialogSlice> = (set) => ({
  cfDialog: initialState,

  openCFDialog: (mode = 'create', format, options) => {
    set({
      cfDialog: {
        isOpen: true,
        mode,
        editingFormat: format ?? null,
        sourceSheetId: options?.sheetId ?? null,
        returnToRulesManager: options?.returnToRulesManager ?? false,
        selectedRuleType: format?.rules[0]?.type ?? 'cellValue',
        quickRuleDialog: null,
        rulesManagerOpen: false,
      },
    });
  },

  closeCFDialog: () => {
    set((s) => ({
      cfDialog: {
        ...initialState,
        rulesManagerOpen: s.cfDialog.returnToRulesManager,
      },
    }));
  },

  setCFRuleType: (ruleType: CFRuleType) => {
    set((s) => ({
      cfDialog: {
        ...s.cfDialog,
        selectedRuleType: ruleType,
      },
    }));
  },

  openQuickRuleDialog: (type: QuickRuleDialogType) => {
    set((s) => ({
      cfDialog: {
        ...s.cfDialog,
        quickRuleDialog: type,
      },
    }));
  },

  closeQuickRuleDialog: () => {
    set((s) => ({
      cfDialog: {
        ...s.cfDialog,
        quickRuleDialog: null,
      },
    }));
  },

  openRulesManager: () => {
    set((s) => ({
      cfDialog: {
        ...s.cfDialog,
        rulesManagerOpen: true,
      },
    }));
  },

  closeRulesManager: () => {
    set((s) => ({
      cfDialog: {
        ...s.cfDialog,
        rulesManagerOpen: false,
      },
    }));
  },

  // 01 aliases — same state mutation as the legacy names.
  openCFRulesManager: () => {
    set((s) => ({
      cfDialog: {
        ...s.cfDialog,
        rulesManagerOpen: true,
      },
    }));
  },

  closeCFRulesManager: () => {
    set((s) => ({
      cfDialog: {
        ...s.cfDialog,
        rulesManagerOpen: false,
      },
    }));
  },
});
