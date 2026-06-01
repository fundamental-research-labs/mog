/**
 * useConditionalFormatting Hook
 *
 * Provides selection-aware operations for conditional formatting.
 * Wraps Worksheet API with convenience methods for quick rule creation,
 * rule management, and clearing operations.
 *
 * Architecture:
 * - Writes: Through unified Worksheet API (ws.conditionalFormats.add, ws.conditionalFormats.remove, etc.)
 * - Reads: Pre-loaded via useEffect into local state from ws.conditionalFormats.list()
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { TableInfo } from '@mog-sdk/contracts/api';

import type {
  CFAboveAverageRule,
  CFCellValueRule,
  CFColorScale,
  CFColorScaleRule,
  CFContainsBlanksRule,
  CFContainsTextRule,
  CFDataBar,
  CFDataBarRule,
  CFDuplicateValuesRule,
  CFIconSet,
  CFIconSetRule,
  CFRule,
  CFStyle,
  CFTextOperator,
  CFTimePeriodRule,
  CFTop10Rule,
  ConditionalFormat,
  DatePeriod,
} from '@mog-sdk/contracts/conditional-format';
import { rangesOverlap, subtractRange } from '@mog/spreadsheet-utils/cf-range-utils';
import type { CellRange } from '@mog-sdk/contracts/core';
import { parseA1Range } from '@mog/spreadsheet-utils/a1';

import { useActiveSheetId, useWorkbook } from '../../infra/context';
import { useActiveCell } from '../selection/use-active-cell';
import { useSelectionRanges } from '../selection/use-granular-selection';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// Types
// =============================================================================

export interface UseConditionalFormattingOptions {
  /** Optional override for sheet ID (defaults to active sheet) */
  sheetId?: string;
}

export interface UseConditionalFormattingReturn {
  // Quick rule creation (uses current selection)
  // Values can be numbers or cell references (e.g., "A1", "$B$1")
  applyGreaterThan: (value: number | string, style: CFStyle) => void;
  applyLessThan: (value: number | string, style: CFStyle) => void;
  applyBetween: (min: number | string, max: number | string, style: CFStyle) => void;
  applyEqualTo: (value: number | string, style: CFStyle) => void;
  applyTextContains: (text: string, operator: CFTextOperator, style: CFStyle) => void;
  applyDuplicates: (unique: boolean, style: CFStyle) => void;
  applyDateOccurring: (period: DatePeriod, style: CFStyle) => void;
  /** Apply a "containsBlanks" rule. When `nonBlanks` is true, the rule
   * highlights non-empty cells instead. */
  applyBlanks: (nonBlanks: boolean, style: CFStyle) => void;

  // Top/Bottom rules
  applyTopN: (n: number, style: CFStyle) => void;
  applyBottomN: (n: number, style: CFStyle) => void;
  applyTopPercent: (percent: number, style: CFStyle) => void;
  applyBottomPercent: (percent: number, style: CFStyle) => void;
  /**
   * Apply above average rule with optional standard deviation.
   * @param style - The style to apply
   * @param stdDev - Optional standard deviations from the average (1, 2, or 3)
   */
  applyAboveAverage: (style: CFStyle, stdDev?: number) => void;
  /**
   * Apply below average rule with optional standard deviation.
   * @param style - The style to apply
   * @param stdDev - Optional standard deviations from the average (1, 2, or 3)
   */
  applyBelowAverage: (style: CFStyle, stdDev?: number) => void;

  // Data visualization rules (Data Bars, Color Scales, Icon Sets)
  /** Apply data bar rule to selection */
  applyDataBar: (dataBar: CFDataBar) => void;
  /** Apply color scale rule to selection */
  applyColorScale: (colorScale: CFColorScale) => void;
  /** Apply icon set rule to selection */
  applyIconSet: (iconSet: CFIconSet) => void;

  // Management
  getRulesForSelection: () => ConditionalFormat[];
  getRulesForSheet: () => ConditionalFormat[];
  deleteRule: (formatId: string, ruleId: string) => boolean;
  deleteFormat: (formatId: string) => boolean;
  updateRulePriority: (formatId: string, ruleId: string, newPriority: number) => boolean;

  // Clear
  clearFromSelection: () => void;
  clearFromSheet: () => void;
  /** Clear CF rules from the table containing the active cell */
  clearFromTable: () => void;
  /** Get the table at the current selection (if any). */
  getTableAtSelection: () => TableInfo | null;

  // Utilities
  getSelectedRange: () => CellRange;
  generateFormatId: () => string;
  generateRuleId: () => string;
}

// =============================================================================
// Helpers
// =============================================================================

/** Generate a unique ID with the given prefix. */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Strip id and priority from a rule — the format-level Worksheet API assigns them.
 */
function toRuleInput(rule: CFRule): Omit<CFRule, 'id' | 'priority'> {
  const { id: _id, priority: _priority, ...rest } = rule;
  return rest;
}

// =============================================================================
// Default Highlight Styles (Excel-compatible)
// =============================================================================

export const DEFAULT_HIGHLIGHT_STYLES = {
  lightRedFillDarkRedText: {
    backgroundColor: '#FFC7CE',
    fontColor: '#9C0006',
  },
  yellowFillDarkYellowText: {
    backgroundColor: '#FFEB9C',
    fontColor: '#9C6500',
  },
  greenFillDarkGreenText: {
    backgroundColor: '#C6EFCE',
    fontColor: '#006100',
  },
  lightRedFill: {
    backgroundColor: '#FFC7CE',
  },
  redText: {
    fontColor: '#9C0006',
  },
  redBorder: {
    borderColor: '#9C0006',
    borderStyle: 'thin' as const,
  },
} as const;

// =============================================================================
// Hook Implementation
// =============================================================================

export function useConditionalFormatting(
  options: UseConditionalFormattingOptions = {},
): UseConditionalFormattingReturn {
  const activeSheetId = useActiveSheetId();
  const { activeCell } = useActiveCell();
  const ranges = useSelectionRanges();
  const coordinator = useCoordinator();
  const wb = useWorkbook();

  // Use provided sheetId or fall back to active sheet
  const sheetId = options.sheetId ?? activeSheetId;

  // ==========================================================================
  // Formats state (loaded from Worksheet API)
  // ==========================================================================

  const [formats, setFormats] = useState<ConditionalFormat[]>([]);
  const [loadVersion, setLoadVersion] = useState(0);
  const reload = useCallback(() => setLoadVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const ws = wb.getSheetById(sheetId);
        const fmts = await ws.conditionalFormats.list();
        if (!cancelled) setFormats(fmts);
      } catch {
        if (!cancelled) setFormats([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [wb, sheetId, loadVersion]);

  // ==========================================================================
  // ON-DEMAND SELECTION READ (for actions)
  // Point-in-time read - does NOT cause re-renders when selection changes
  // @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
  // ==========================================================================
  const getSelectedRangeOnDemand = useCallback((): CellRange | null => {
    const snapshot = coordinator.grid.getSelectionSnapshot();
    const range = snapshot.ranges[0];
    if (!range) {
      // Fall back to active cell (preserves existing getSelectedRange behavior)
      const { activeCell: ac } = snapshot;
      return {
        startRow: ac.row,
        startCol: ac.col,
        endRow: ac.row,
        endCol: ac.col,
      };
    }
    return {
      startRow: range.startRow,
      startCol: range.startCol,
      endRow: range.endRow,
      endCol: range.endCol,
    };
  }, [coordinator]);

  // ==========================================================================
  // ON-DEMAND TABLE LOOKUP (for clearFromTable action)
  // @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
  // ==========================================================================
  const getTableAtSelectionOnDemand = useCallback(async (): Promise<TableInfo | null> => {
    const snapshot = coordinator.grid.getSelectionSnapshot();
    const { activeCell: ac } = snapshot;
    try {
      const ws = wb.getSheetById(sheetId);
      const table = await ws.tables.getAtCell(ac.row, ac.col);
      return table ?? null;
    } catch {
      return null;
    }
  }, [wb, sheetId, coordinator]);

  // ==========================================================================
  // REACTIVE SELECTION (for UI display only)
  // This is acceptable for methods like getRulesForSelection that power UI
  // ==========================================================================

  // Get the currently selected range (for reactive UI like getRulesForSelection)
  const getSelectedRange = useCallback((): CellRange => {
    const range = ranges[0];
    return {
      startRow: range?.startRow ?? activeCell.row,
      startCol: range?.startCol ?? activeCell.col,
      endRow: range?.endRow ?? activeCell.row,
      endCol: range?.endCol ?? activeCell.col,
    };
  }, [ranges, activeCell]);

  // Helper to create a format with a single rule.
  // Writes go through the unified Worksheet API (ws.conditionalFormats.add).
  const createFormatWithRule = useCallback(
    (rule: CFRule, selection: CellRange): void => {
      const ws = wb.getSheetById(sheetId);
      // Fire-and-forget: preserves sync void return for all apply* callers.
      void ws.conditionalFormats
        .add(
          [
            {
              startRow: selection.startRow,
              startCol: selection.startCol,
              endRow: selection.endRow,
              endCol: selection.endCol,
            },
          ],
          [toRuleInput(rule)],
        )
        .then(reload)
        .catch((err: unknown) => {
          console.error('[use-conditional-formatting] addConditionalFormat failed:', err);
        });
    },
    [wb, sheetId, reload],
  );

  // ==========================================================================
  // Quick Rule Creation (Cell Value Rules)
  // ==========================================================================

  const applyGreaterThan = useCallback(
    (value: number | string, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFCellValueRule = {
        id: generateId('rule'),
        type: 'cellValue',
        priority: 0,
        operator: 'greaterThan',
        value1: value,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyLessThan = useCallback(
    (value: number | string, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFCellValueRule = {
        id: generateId('rule'),
        type: 'cellValue',
        priority: 0,
        operator: 'lessThan',
        value1: value,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyBetween = useCallback(
    (min: number | string, max: number | string, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFCellValueRule = {
        id: generateId('rule'),
        type: 'cellValue',
        priority: 0,
        operator: 'between',
        value1: min,
        value2: max,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyEqualTo = useCallback(
    (value: number | string, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFCellValueRule = {
        id: generateId('rule'),
        type: 'cellValue',
        priority: 0,
        operator: 'equal',
        value1: value,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyTextContains = useCallback(
    (text: string, operator: CFTextOperator, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFContainsTextRule = {
        id: generateId('rule'),
        type: 'containsText',
        priority: 0,
        operator,
        text,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyDuplicates = useCallback(
    (unique: boolean, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFDuplicateValuesRule = {
        id: generateId('rule'),
        type: 'duplicateValues',
        priority: 0,
        unique,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyDateOccurring = useCallback(
    (period: DatePeriod, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFTimePeriodRule = {
        id: generateId('rule'),
        type: 'timePeriod',
        priority: 0,
        timePeriod: period,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyBlanks = useCallback(
    (nonBlanks: boolean, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFContainsBlanksRule = {
        id: generateId('rule'),
        type: 'containsBlanks',
        priority: 0,
        // `blanks: true` matches blank cells; `false` matches non-blank cells
        // (parity with Excel's "Format only cells that contain > Blanks/No Blanks").
        blanks: !nonBlanks,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  // ==========================================================================
  // Top/Bottom Rules
  // ==========================================================================

  const applyTopN = useCallback(
    (n: number, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFTop10Rule = {
        id: generateId('rule'),
        type: 'top10',
        priority: 0,
        rank: n,
        percent: false,
        bottom: false,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyBottomN = useCallback(
    (n: number, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFTop10Rule = {
        id: generateId('rule'),
        type: 'top10',
        priority: 0,
        rank: n,
        percent: false,
        bottom: true,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyTopPercent = useCallback(
    (percent: number, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFTop10Rule = {
        id: generateId('rule'),
        type: 'top10',
        priority: 0,
        rank: percent,
        percent: true,
        bottom: false,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyBottomPercent = useCallback(
    (percent: number, style: CFStyle): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFTop10Rule = {
        id: generateId('rule'),
        type: 'top10',
        priority: 0,
        rank: percent,
        percent: true,
        bottom: true,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyAboveAverage = useCallback(
    (style: CFStyle, stdDev?: number): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFAboveAverageRule = {
        id: generateId('rule'),
        type: 'aboveAverage',
        priority: 0,
        aboveAverage: true,
        stdDev: stdDev && stdDev > 0 ? stdDev : undefined,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyBelowAverage = useCallback(
    (style: CFStyle, stdDev?: number): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFAboveAverageRule = {
        id: generateId('rule'),
        type: 'aboveAverage',
        priority: 0,
        aboveAverage: false,
        stdDev: stdDev && stdDev > 0 ? stdDev : undefined,
        style,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  // ==========================================================================
  // Data Visualization Rules (Data Bars, Color Scales, Icon Sets)
  // ==========================================================================

  const applyDataBar = useCallback(
    (dataBar: CFDataBar): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFDataBarRule = {
        id: generateId('rule'),
        type: 'dataBar',
        priority: 0,
        dataBar,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyColorScale = useCallback(
    (colorScale: CFColorScale): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFColorScaleRule = {
        id: generateId('rule'),
        type: 'colorScale',
        priority: 0,
        colorScale,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  const applyIconSet = useCallback(
    (iconSet: CFIconSet): void => {
      const selection = getSelectedRangeOnDemand();
      if (!selection) return;
      const rule: CFIconSetRule = {
        id: generateId('rule'),
        type: 'iconSet',
        priority: 0,
        iconSet,
      };
      createFormatWithRule(rule, selection);
    },
    [createFormatWithRule, getSelectedRangeOnDemand],
  );

  // ==========================================================================
  // Management
  // ==========================================================================

  const getRulesForSelection = useCallback((): ConditionalFormat[] => {
    const range = getSelectedRange();
    return formats.filter((format) => {
      if (!format.ranges || format.ranges.length === 0) return false;
      return format.ranges.some(
        (r) =>
          r.startRow <= range.endRow &&
          r.endRow >= range.startRow &&
          r.startCol <= range.endCol &&
          r.endCol >= range.startCol,
      );
    });
  }, [formats, getSelectedRange]);

  const getRulesForSheet = useCallback((): ConditionalFormat[] => {
    return formats;
  }, [formats]);

  const deleteRule = useCallback(
    (formatId: string, ruleId: string): boolean => {
      const format = formats.find((f) => f.id === formatId);
      if (!format) return false;

      const remainingRules = format.rules.filter((r) => r.id !== ruleId);
      const ws = wb.getSheetById(sheetId);

      if (remainingRules.length === 0) {
        void ws.conditionalFormats
          .remove(formatId)
          .then(reload)
          .catch((e) => console.error('[use-conditional-formatting] deleteRule failed:', e));
      } else {
        void ws.conditionalFormats
          .update(formatId, { rules: remainingRules })
          .then(reload)
          .catch((e) => console.error('[use-conditional-formatting] deleteRule failed:', e));
      }
      return true; // Optimistic
    },
    [wb, sheetId, formats, reload],
  );

  const deleteFormat = useCallback(
    (formatId: string): boolean => {
      void wb
        .getSheetById(sheetId)
        .conditionalFormats.remove(formatId)
        .then(reload)
        .catch((e) => console.error('[use-conditional-formatting] deleteFormat failed:', e));
      return true; // Optimistic
    },
    [wb, sheetId, reload],
  );

  const updateRulePriority = useCallback(
    (formatId: string, ruleId: string, newPriority: number): boolean => {
      const format = formats.find((f) => f.id === formatId);
      if (!format) return false;

      const updatedRules = format.rules.map((r) =>
        r.id === ruleId ? { ...r, priority: newPriority } : r,
      );
      void wb
        .getSheetById(sheetId)
        .conditionalFormats.update(formatId, { rules: updatedRules })
        .then(reload)
        .catch((e) => console.error('[use-conditional-formatting] updateRulePriority failed:', e));
      return true; // Optimistic
    },
    [wb, sheetId, formats, reload],
  );

  // ==========================================================================
  // Clear Operations
  // ==========================================================================

  const clearFromSelection = useCallback((): void => {
    const selection = getSelectedRangeOnDemand();
    if (!selection) return;

    void (async () => {
      try {
        const ws = wb.getSheetById(sheetId);
        await ws.conditionalFormats.clearInRanges([selection]);
        reload();
      } catch (e) {
        console.error('[use-conditional-formatting] clearFromSelection failed:', e);
      }
    })();
  }, [wb, sheetId, getSelectedRangeOnDemand, reload]);

  const clearFromSheet = useCallback((): void => {
    void wb
      .getSheetById(sheetId)
      .conditionalFormats.clear()
      .then(reload)
      .catch((e) => console.error('[use-conditional-formatting] clearFromSheet failed:', e));
  }, [wb, sheetId, reload]);

  // Get table at current selection (reactive, for UI display)
  const tableAtSelectionRef = useRef<TableInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ws = wb.getSheetById(sheetId);
        const table = await ws.tables.getAtCell(activeCell.row, activeCell.col);
        if (!cancelled) {
          tableAtSelectionRef.current = table ?? null;
        }
      } catch {
        if (!cancelled) {
          tableAtSelectionRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wb, sheetId, activeCell.row, activeCell.col]);

  const getTableAtSelection = useCallback((): TableInfo | null => {
    return tableAtSelectionRef.current;
  }, []);

  /**
   * Clear CF rules from the table containing the active cell.
   *
   * Excel-compatible partial overlap handling.
   * Uses the same range subtraction logic as clearFromSelection.
   *
   */
  const clearFromTable = useCallback((): void => {
    void (async () => {
      try {
        const table = await getTableAtSelectionOnDemand();
        if (!table || !table.range) return;

        // Parse the A1 notation range string into a CellRange
        const tableRange: CellRange = parseA1Range(table.range);

        const ws = wb.getSheetById(sheetId);
        const allFormats = await ws.conditionalFormats.list();

        for (const format of allFormats) {
          if (!format.ranges || format.ranges.length === 0) continue;

          const newRanges: CellRange[] = [];
          let hasChanges = false;

          for (const range of format.ranges) {
            if (rangesOverlap(range, tableRange)) {
              const remaining = subtractRange(range, tableRange);
              newRanges.push(...remaining);
              hasChanges = true;
            } else {
              newRanges.push(range);
            }
          }

          if (hasChanges) {
            // Delete the old format
            await ws.conditionalFormats.remove(format.id);
            // Re-create with remaining ranges (if any)
            if (newRanges.length > 0) {
              await ws.conditionalFormats.add(
                newRanges,
                format.rules.map((r) => toRuleInput(r)),
              );
            }
          }
        }
        reload();
      } catch (e) {
        console.error('[use-conditional-formatting] clearFromTable failed:', e);
      }
    })();
  }, [wb, sheetId, getTableAtSelectionOnDemand, reload]);

  // ==========================================================================
  // Utilities
  // ==========================================================================

  const generateFormatId = useCallback(() => generateId('cf'), []);
  const generateRuleId = useCallback(() => generateId('rule'), []);

  return {
    // Quick rule creation
    applyGreaterThan,
    applyLessThan,
    applyBetween,
    applyEqualTo,
    applyTextContains,
    applyDuplicates,
    applyDateOccurring,
    applyBlanks,

    // Top/Bottom rules
    applyTopN,
    applyBottomN,
    applyTopPercent,
    applyBottomPercent,
    applyAboveAverage,
    applyBelowAverage,

    // Data visualization rules
    applyDataBar,
    applyColorScale,
    applyIconSet,

    // Management
    getRulesForSelection,
    getRulesForSheet,
    deleteRule,
    deleteFormat,
    updateRulePriority,

    // Clear
    clearFromSelection,
    clearFromSheet,
    clearFromTable, //
    getTableAtSelection, //

    // Utilities
    getSelectedRange,
    generateFormatId,
    generateRuleId,
  };
}
