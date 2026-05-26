/**
 * Data Tab Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 Data-tab Alt-chord keytips, lifted out of DataRibbon.tsx
 * `keyTipRegistry.register({ ..., action })` inline closures into typed
 * `KeyboardShortcut` chord entries.
 *
 * `Alt+A` is the Data-tab activator (see `ribbon.ts`); the entries below
 * fire after the second-keystroke follow-on.
 *
 * Alt+A,KeyG → Get Data dropdown (OPEN_RIBBON_DROPDOWN: data.get-data)
 * Alt+A,KeyA → Sort Ascending (SORT_ASCENDING)
 * Alt+A,KeyZ → Sort Descending (SORT_DESCENDING)
 * Alt+A,KeyF → Toggle AutoFilter (TOGGLE_AUTO_FILTER)
 * Alt+A,KeyO → Group rows (GROUP_ROWS)
 * Alt+A,KeyU → Ungroup rows (UNGROUP_ROWS)
 * Alt+A,KeyS,KeyU → Subtotal dialog (OPEN_SUBTOTAL_DIALOG; 3-key chord)
 *
 * Pre-existing `Alt+A,KeyV,KeyV → OPEN_DV_DIALOG` and
 * `Alt+A,KeyW,Key{G,S,T} → OPEN_{GOAL_SEEK,SCENARIO_MANAGER,DATA_TABLE}_DIALOG`
 * chords live in `keyboard/definitions/data.ts`; no
 * duplicate entries here.
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const DATA_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_DATA_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'keytips-data.get-data',
    bindings: altBinding('KeyA'),
    sequence: ['KeyG'],
    description: 'Open Get Data dropdown (Alt+A,G)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'data.get-data' },
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: DATA_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Data → G opens Get Data import menu (CSV/JSON/Web).',
  },
  {
    id: 'keytips-data.sort-asc',
    bindings: altBinding('KeyA'),
    sequence: ['KeyA'],
    description: 'Sort Ascending (Alt+A,A)',
    action: 'SORT_ASCENDING',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: DATA_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Data → A sorts ascending.',
  },
  {
    id: 'keytips-data.sort-desc',
    bindings: altBinding('KeyA'),
    sequence: ['KeyZ'],
    description: 'Sort Descending (Alt+A,Z)',
    action: 'SORT_DESCENDING',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: DATA_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Data → Z sorts descending.',
  },
  {
    id: 'keytips-data.filter',
    bindings: altBinding('KeyA'),
    sequence: ['KeyF'],
    description: 'Toggle AutoFilter (Alt+A,F)',
    action: 'TOGGLE_AUTO_FILTER',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: DATA_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Data → F toggles AutoFilter.',
  },
  {
    id: 'keytips-data.group',
    bindings: altBinding('KeyA'),
    sequence: ['KeyO'],
    description: 'Group rows (Alt+A,O)',
    action: 'GROUP',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: DATA_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Data → O groups selected rows.',
  },
  {
    id: 'keytips-data.ungroup',
    bindings: altBinding('KeyA'),
    sequence: ['KeyU'],
    description: 'Ungroup rows (Alt+A,U)',
    action: 'UNGROUP',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: DATA_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Data → U ungroups selected rows.',
  },
  {
    id: 'keytips-data.subtotal',
    bindings: altBinding('KeyA'),
    sequence: ['KeyS', 'KeyU'],
    description: 'Open Subtotal dialog (Alt+A,S,U)',
    action: 'OPEN_SUBTOTAL_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: DATA_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Three-key chord because the bare Alt+A,S would conflict with Alt+A,W,S (Scenario Manager).',
  },
];
