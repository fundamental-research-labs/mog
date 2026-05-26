/**
 * Format Painter Slice
 *
 * Manages state for the format painter tool.
 *
 * Format Painter
 */

import type { StateCreator } from 'zustand';

import type { ValidationRule } from '@mog-sdk/contracts/api';
import type { CellFormat, CellRange } from '@mog-sdk/contracts/core';

import type { ConditionalFormat } from '@mog-sdk/contracts/conditional-format';

/**
 * Format Painter UI state
 */
export interface FormatPainterState {
  /** Whether format painter mode is active */
  isActive: boolean;
  /** Whether format painter is locked (double-click to keep painting) */
  isLocked: boolean;
  /** The source format to paint */
  sourceFormat: CellFormat | null;
  /** The source range for pattern replication when target is larger than source */
  sourceRange: CellRange | null;
  /** Source sheet ID for cross-sheet format painting */
  sourceSheetId: string | null;
  /** CF rules from source range for format painter */
  sourceConditionalFormats: ConditionalFormat[] | null;
  /** Validation schemas from source range for format painter */
  sourceValidationSchemas: ValidationRule[] | null;
}

export interface FormatPainterSlice {
  formatPainter: FormatPainterState;
  /** Start format painter with source format, range, sheet ID, optional CF rules, and optional validation schemas */
  startFormatPainter: (
    format: CellFormat,
    range: CellRange,
    sheetId: string,
    conditionalFormats?: ConditionalFormat[],
    validationSchemas?: ValidationRule[],
  ) => void;
  stopFormatPainter: () => void;
  lockFormatPainter: () => void;
}

const initialState: FormatPainterState = {
  isActive: false,
  isLocked: false,
  sourceFormat: null,
  sourceRange: null,
  sourceSheetId: null,
  sourceConditionalFormats: null,
  sourceValidationSchemas: null,
};

export const createFormatPainterSlice: StateCreator<
  FormatPainterSlice,
  [],
  [],
  FormatPainterSlice
> = (set) => ({
  formatPainter: initialState,

  startFormatPainter: (
    format: CellFormat,
    range: CellRange,
    sheetId: string,
    conditionalFormats?: ConditionalFormat[],
    validationSchemas?: ValidationRule[],
  ) => {
    set({
      formatPainter: {
        isActive: true,
        isLocked: false,
        sourceFormat: format,
        sourceRange: range,
        sourceSheetId: sheetId,
        sourceConditionalFormats: conditionalFormats ?? null,
        sourceValidationSchemas: validationSchemas ?? null,
      },
    });
  },

  stopFormatPainter: () => {
    set({ formatPainter: initialState });
  },

  lockFormatPainter: () => {
    set((s) => ({
      formatPainter: {
        ...s.formatPainter,
        isLocked: true,
      },
    }));
  },
});
