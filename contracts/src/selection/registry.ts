/**
 * Selection Behavior Registry
 *
 * Single source of truth for all Excel selection behaviors.
 * Metadata only - algorithms live in engine.
 *
 * IMPORTANT: `implemented` must be HONEST.
 * - `true` = Fully implemented with correct behavior
 * - `false` = Not implemented OR uses placeholder/hardcoded logic
 *
 * Use `notes` field to document partial implementations or placeholders.
 *
 */

import type { SelectionRegistry } from './types';

// =============================================================================
// Registry
// =============================================================================

export const SELECTION_BEHAVIOR_REGISTRY: SelectionRegistry = {
  // ===========================================================================
  // Selection Modes
  // ===========================================================================
  modes: [
    {
      name: 'Single cell selection',
      description: 'Click to select one cell',
      implemented: true,
      priority: 'critical',
    },
    {
      name: 'Range selection (drag)',
      description: 'Click and drag for rectangle',
      implemented: true,
      priority: 'critical',
    },
    {
      name: 'Range selection (Shift+click)',
      description: 'Shift+click to extend from active cell',
      implemented: true,
      priority: 'critical',
    },
    {
      name: 'Multi-range (Ctrl+click)',
      description: 'Ctrl+click for non-contiguous ranges',
      implemented: true,
      priority: 'high',
    },
    {
      name: 'Entire row (header click)',
      description: 'Click row header to select entire row',
      implemented: true,
      priority: 'high',
    },
    {
      name: 'Entire column (header click)',
      description: 'Click column header to select entire column',
      implemented: true,
      priority: 'high',
    },
    {
      name: 'Multiple rows (header drag)',
      description: 'Drag row headers to select multiple rows',
      implemented: true,
      priority: 'high',
    },
    {
      name: 'Multiple columns (header drag)',
      description: 'Drag column headers to select multiple columns',
      implemented: true,
      priority: 'high',
    },
    {
      name: 'Select all',
      description: 'Click corner button or Ctrl+A',
      implemented: true,
      priority: 'critical',
      notes: 'Uses placeholder bounds {endRow:999, endCol:25} - should use actual used range',
    },
    {
      name: 'Add to selection mode (Shift+F8)',
      description: 'Non-adjacent selection without holding Ctrl',
      implemented: false,
      priority: 'low',
    },
  ],

  // ===========================================================================
  // Data-Aware Navigation
  // ===========================================================================
  navigation: [
    {
      name: 'Arrow key movement',
      description: 'Move one cell in direction',
      implemented: true,
      priority: 'critical',
    },
    {
      name: 'Ctrl+Arrow to edge',
      description: 'Jump to edge of data region',
      implemented: true,
      priority: 'critical',
      notes: 'Uses findDataEdge algorithm in keyboard-coordination.ts',
    },
    {
      name: 'Ctrl+Shift+Arrow extend',
      description: 'Extend selection to edge of data region',
      implemented: true,
      priority: 'high',
      notes: 'Uses findDataEdge algorithm in keyboard-coordination.ts',
    },
    {
      name: 'Ctrl+Home to A1',
      description: 'Go to cell A1',
      implemented: true,
      priority: 'critical',
    },
    {
      name: 'Ctrl+End to last used',
      description: 'Go to last used cell in sheet',
      implemented: true,
      priority: 'high',
      notes: 'Uses findLastUsedCell algorithm in keyboard-coordination.ts',
    },
    {
      name: 'Ctrl+Shift+Home extend',
      description: 'Extend selection to A1',
      implemented: true,
      priority: 'medium',
    },
    {
      name: 'Ctrl+Shift+End extend',
      description: 'Extend selection to last used cell',
      implemented: true,
      priority: 'medium',
      notes: 'Uses findLastUsedCell algorithm in keyboard-coordination.ts',
    },
    {
      name: 'Current region (Ctrl+Shift+*)',
      description: 'Select contiguous data block around active cell',
      implemented: true,
      priority: 'high',
      notes: 'data-operations.ts:224 getCurrentRegion, keyboard-coordination.ts:1048',
    },
    {
      name: 'Ctrl+A current region first',
      description: 'First Ctrl+A = current region, second = all',
      implemented: false,
      priority: 'medium',
      notes: 'Currently goes directly to select all',
    },
    {
      name: 'End mode navigation',
      description: 'End key then arrow for alternative edge jump',
      implemented: false,
      priority: 'low',
    },
    {
      name: 'Page Up/Down',
      description: 'Move by viewport height',
      implemented: true,
      priority: 'high',
    },
    {
      name: 'Alt+Page Up/Down',
      description: 'Move by viewport width (horizontal page)',
      implemented: true,
      priority: 'medium',
    },
  ],

  // ===========================================================================
  // Special Selections (Go To Special)
  // ===========================================================================
  specialSelections: [
    {
      name: 'Select blanks',
      description: 'Select all empty cells in selection',
      implemented: true,
      priority: 'high',
      notes: 'Uses findSpecialCells in special-selections.ts',
    },
    {
      name: 'Select constants',
      description: 'Select cells with literal values (not formulas)',
      implemented: true,
      priority: 'medium',
      notes: 'Uses findSpecialCells in special-selections.ts',
    },
    {
      name: 'Select formulas',
      description: 'Select all cells containing formulas',
      implemented: true,
      priority: 'high',
      notes: 'Uses findSpecialCells in special-selections.ts',
    },
    {
      name: 'Select numbers',
      description: 'Select numeric constants only',
      implemented: true,
      priority: 'low',
      notes: 'Uses findSpecialCells in special-selections.ts',
    },
    {
      name: 'Select text',
      description: 'Select text constants only',
      implemented: true,
      priority: 'low',
      notes: 'Uses findSpecialCells in special-selections.ts',
    },
    {
      name: 'Select errors',
      description: 'Select cells with error values (#REF!, #VALUE!, etc.)',
      implemented: true,
      priority: 'medium',
      notes: 'Uses findSpecialCells in special-selections.ts',
    },
    {
      name: 'Select precedents (Ctrl+[)',
      description: 'Select cells referenced by active cell formula',
      implemented: true,
      priority: 'medium',
      notes: 'keyboard-coordination.ts:1063-1089, uses calculator.getCellPrecedents',
    },
    {
      name: 'Select dependents (Ctrl+])',
      description: 'Select cells that reference active cell',
      implemented: true,
      priority: 'medium',
      notes: 'keyboard-coordination.ts:1091-1120, uses calculator.getCellDependents',
    },
    {
      name: 'Select visible cells only (Alt+;)',
      description: 'Select only visible cells, skipping hidden rows/columns',
      implemented: false,
      priority: 'medium',
    },
    {
      name: 'Select conditional formats',
      description: 'Select cells with conditional formatting rules',
      implemented: false,
      priority: 'low',
    },
    {
      name: 'Select data validation',
      description: 'Select cells with data validation rules',
      implemented: false,
      priority: 'low',
    },
    {
      name: 'Go To Special dialog',
      description: 'UI dialog for special selection types',
      implemented: false,
      priority: 'medium',
      notes: 'Requires UI component implementation',
    },
  ],

  // ===========================================================================
  // Fill Handle Behaviors
  // ===========================================================================
  fillHandle: [
    {
      name: 'Fill handle visible',
      description: 'Small square at bottom-right of selection',
      implemented: true,
      priority: 'critical',
    },
    {
      name: 'Drag to copy',
      description: 'Copy single value by dragging',
      implemented: true,
      priority: 'critical',
    },
    {
      name: 'Number series detection',
      description: 'Detect pattern from 1,2 and fill 3,4,5...',
      implemented: true,
      priority: 'high',
      notes: 'fill-patterns.ts detectLinearPattern/detectGrowthPattern, wired via FillCoordinator',
    },
    {
      name: 'Date increment (days)',
      description: 'Jan 1 -> Jan 2 -> Jan 3...',
      implemented: true,
      priority: 'high',
      notes: 'fill-patterns.ts detectDatePattern with dateUnit=day, wired via FillCoordinator',
    },
    {
      name: 'Date increment (months)',
      description: 'Jan -> Feb -> Mar...',
      implemented: true,
      priority: 'medium',
      notes: 'fill-patterns.ts detectDatePattern with dateUnit=month, wired via FillCoordinator',
    },
    {
      name: 'Date increment (years)',
      description: '2024 -> 2025 -> 2026...',
      implemented: true,
      priority: 'medium',
      notes: 'fill-patterns.ts detectDatePattern with dateUnit=year, wired via FillCoordinator',
    },
    {
      name: 'Day names fill',
      description: 'Mon -> Tue -> Wed...',
      implemented: true,
      priority: 'medium',
      notes:
        'fill-patterns.ts detectWeekdayPattern, supports full and short names, wired via FillCoordinator',
    },
    {
      name: 'Month names fill',
      description: 'Jan -> Feb -> Mar... or January -> February...',
      implemented: true,
      priority: 'medium',
      notes:
        'fill-patterns.ts detectMonthPattern, supports full and short names, wired via FillCoordinator',
    },
    {
      name: 'Quarter fill',
      description: 'Q1 -> Q2 -> Q3 -> Q4...',
      implemented: true,
      priority: 'medium',
      notes: 'fill-patterns.ts detectQuarterPattern, wired via FillCoordinator',
    },
    {
      name: 'Growth series detection',
      description: 'Detect pattern from 2,4 and fill 8,16,32...',
      implemented: true,
      priority: 'medium',
      notes: 'fill-patterns.ts detectGrowthPattern, wired via FillCoordinator',
    },
    {
      name: 'Formula fill with reference adjustment',
      description: 'Copy formula with relative reference adjustment',
      implemented: true,
      priority: 'critical',
      notes: 'fill-executor.ts fillFormulaCell with calculateAdjustedPositions',
    },
    {
      name: 'Fill up/left',
      description: 'Drag fill handle in any direction',
      implemented: true,
      priority: 'high',
      notes: 'fill-executor.ts supports all 4 directions, backward series generation',
    },
    {
      name: 'Auto Fill Options menu',
      description: 'Popup menu after fill with options (Copy, Fill Series, etc.)',
      implemented: false,
      priority: 'medium',
      notes: 'FillCoordinator.refillWithOptions() exists but UI not implemented',
    },
    {
      name: 'Flash Fill (Ctrl+E)',
      description: 'Smart pattern detection and auto-complete',
      implemented: false,
      priority: 'low',
      notes: 'Complex ML-like feature, low priority',
    },
    {
      name: 'Custom fill lists',
      description: 'User-defined sequences for fill',
      implemented: false,
      priority: 'low',
    },
  ],
};
