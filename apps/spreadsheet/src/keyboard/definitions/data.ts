/**
 * Data Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for data operations:
 * - Find/Replace
 * - Sort/Filter
 * - Group/Outline
 * - Data Validation
 * - Scenarios
 *
 * NOTE: Some shortcuts like Alt+A,V,V are sequential key sequences.
 * These are documented here but may need special handling in the
 * KeyTip system rather than the standard shortcut matcher.
 *
 * Total: 16 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { altBinding, crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const DATA_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Find/Replace
  // ===========================================================================

  {
    id: 'open-find-dialog',
    bindings: crossPlatformBinding('KeyF', 'ctrl'),
    description: 'Find',
    action: 'OPEN_FIND_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'data',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'f',
  },
  {
    id: 'open-find-replace-dialog',
    bindings: crossPlatformBinding('KeyH', 'ctrl'),
    description: 'Find and Replace',
    action: 'OPEN_FIND_REPLACE_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'data',
    contexts: ['any'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Hide window (Mac)',
      policy: 'override',
    },
    matchBy: 'key',
    expectedCharacter: 'h',
  },
  {
    id: 'find-next',
    bindings: universalBinding('F4', 'shift'),
    description: 'Find next',
    action: 'FIND_NEXT',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'find-previous',
    bindings: crossPlatformBinding('F4', 'ctrl', 'shift'),
    description: 'Find previous',
    action: 'FIND_PREVIOUS',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Sort/Filter
  // ===========================================================================

  {
    id: 'toggle-auto-filter',
    bindings: crossPlatformBinding('KeyL', 'ctrl', 'shift'),
    description: 'Toggle AutoFilter',
    action: 'TOGGLE_AUTO_FILTER',
    enabled: true,
    priority: 'high',
    category: 'data',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'l',
  },
  {
    id: 'open-dropdown',
    bindings: altBinding('ArrowDown'),
    description: 'Open filter dropdown (or autocomplete in cell)',
    action: 'OPEN_DROPDOWN',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid', 'enterMode', 'editMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Group/Outline
  // ===========================================================================

  {
    id: 'group',
    bindings: altBinding('ArrowRight', 'shift'),
    description: 'Group rows/columns',
    action: 'GROUP',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'ungroup',
    bindings: altBinding('ArrowLeft', 'shift'),
    description: 'Ungroup rows/columns',
    action: 'UNGROUP',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'show-detail',
    bindings: altBinding('ArrowDown', 'shift'),
    description: 'Show detail (expand groups)',
    action: 'SHOW_DETAIL',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'hide-detail',
    bindings: altBinding('ArrowUp', 'shift'),
    description: 'Hide detail (collapse groups)',
    action: 'HIDE_DETAIL',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Quick Analysis
  // ===========================================================================

  {
    id: 'open-quick-analysis',
    bindings: crossPlatformBinding('KeyQ', 'ctrl'),
    description: 'Quick Analysis (show formatting/charting options for selection)',
    action: 'OPEN_QUICK_ANALYSIS',
    enabled: false, // Not yet implemented
    priority: 'medium',
    category: 'data',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    notes: 'Opens Quick Analysis menu for selected data range',
    browserConflict: {
      conflictsWith: 'Quit browser (Mac)',
      policy: 'override',
    },
    matchBy: 'key',
    expectedCharacter: 'q',
  },

  // ===========================================================================
  // Data Validation (Alt+A,V,V)
  //
  // unified keytip router: real three-key chord. The bare-`Alt+A`
  // stub that lived here pre-empted the Data ribbon-tab switch
  // (`ribbon.switch-data`); the chord variant below leaves Alt+A
  // free for the tab-switch and only fires OPEN_DV_DIALOG after the
  // KeyV,KeyV follow-on.
  // ===========================================================================

  {
    id: 'open-dv-dialog',
    bindings: altBinding('KeyA'),
    sequence: ['KeyV', 'KeyV'],
    description: 'Open Data Validation dialog (Alt+A,V,V)',
    action: 'OPEN_DV_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Data → V → V opens Data Validation dialog. unified keytip router migration.',
  },

  // ===========================================================================
  // Scenarios (Alt+A,W,{G,S,T})
  //
  // unified keytip router: real three-key chords. Previously these
  // entries used standalone Alt+letter placeholders with `enabled:
  // false` because chord routing wasn't supported; / land it, so
  // these fire after the KeyW,Key{G,S,T} follow-ons.
  // ===========================================================================

  {
    id: 'open-goal-seek-dialog',
    bindings: altBinding('KeyA'),
    sequence: ['KeyW', 'KeyG'],
    description: 'Open Goal Seek dialog (Alt+A,W,G)',
    action: 'OPEN_GOAL_SEEK_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Compatibility keytip: Data → W (Scenarios) → G opens Goal Seek dialog.',
  },
  {
    id: 'open-scenario-manager-dialog',
    bindings: altBinding('KeyA'),
    sequence: ['KeyW', 'KeyS'],
    description: 'Open Scenario Manager dialog (Alt+A,W,S)',
    action: 'OPEN_SCENARIO_MANAGER_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Compatibility keytip: Data → W (Scenarios) → S opens Scenario Manager dialog.',
  },
  {
    id: 'open-data-table-dialog',
    bindings: altBinding('KeyA'),
    sequence: ['KeyW', 'KeyT'],
    description: 'Open Data Table dialog (Alt+A,W,T)',
    action: 'OPEN_DATA_TABLE_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Compatibility keytip: Data → W (Scenarios) → T opens Data Table dialog.',
  },

  // ===========================================================================
  // Reapply Filter
  // ===========================================================================

  {
    id: 'reapply-filter',
    // Ctrl+Alt+L on all platforms (Mac uses physical Ctrl+Option, not Cmd+Option)
    bindings: {
      default: { code: 'KeyL', modifiers: ['alt', 'ctrl'] },
      macos: { code: 'KeyL', modifiers: ['alt', 'ctrl'] },
    },
    description: 'Reapply current filter and sort',
    action: 'REAPPLY_FILTERS',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Reapplies the current filter and sort criteria on the active range after data changes. Mac uses physical Ctrl+Option (not Cmd+Option).',
  },

  // ===========================================================================
  // Pivot Table Dialog
  // ===========================================================================

  {
    id: 'open-pivot-dialog',
    bindings: altBinding('KeyP', 'shift'),
    description: 'Open Pivot Table dialog',
    action: 'OPEN_PIVOT_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'p',
  },
];
