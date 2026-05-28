/**
 * Table Design (contextual) Tab Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 Table Design contextual-tab Alt-chord keytips, lifted out of
 * TableDesignRibbon.tsx `keyTipRegistry.register({ ..., action })` inline
 * closures into typed `KeyboardShortcut` chord entries.
 *
 * `Alt+J,KeyT` switches to the Table Design tab (see `ribbon.ts`); the
 * entries below fire after the third-keystroke follow-on, so the full
 * chord is `Alt+J,T,<key>`.
 *
 * Alt+J,T,KeyC → Confirm Convert to Range (OPEN_CONVERT_TO_RANGE_DIALOG)
 * Alt+J,T,KeyD → Delete table (DELETE_TABLE)
 * Alt+J,T,KeyS → Style gallery dropdown (OPEN_RIBBON_DROPDOWN: table-design.style-gallery)
 * Alt+J,T,KeyH → Toggle Header row (TOGGLE_TABLE_HEADER_ROW)
 * Alt+J,T,KeyT → Toggle Total row (TOGGLE_TABLE_TOTALS_ROW)
 * Alt+J,T,KeyB → Toggle Banded rows (TOGGLE_TABLE_BANDED_ROWS)
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const TABLE_DESIGN_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_TABLE_DESIGN_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'keytips-table-design.convert-to-range',
    bindings: altBinding('KeyJ'),
    sequence: ['KeyT', 'KeyC'],
    description: 'Confirm convert table to range (Alt+J,T,C)',
    action: 'OPEN_CONVERT_TO_RANGE_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: TABLE_DESIGN_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Table Design → C opens confirmation before converting to a normal range.',
  },
  {
    id: 'keytips-table-design.delete',
    bindings: altBinding('KeyJ'),
    sequence: ['KeyT', 'KeyD'],
    description: 'Delete table (Alt+J,T,D)',
    action: 'DELETE_TABLE',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: TABLE_DESIGN_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Table Design → D deletes the table.',
  },
  {
    id: 'keytips-table-design.style-gallery',
    bindings: altBinding('KeyJ'),
    sequence: ['KeyT', 'KeyS'],
    description: 'Open Table style gallery (Alt+J,T,S)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'table-design.style-gallery' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: TABLE_DESIGN_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Table Design → S opens the Table Style gallery.',
  },
  {
    id: 'keytips-table-design.header-row',
    bindings: altBinding('KeyJ'),
    sequence: ['KeyT', 'KeyH'],
    description: 'Toggle Header row (Alt+J,T,H)',
    action: 'TOGGLE_TABLE_HEADER_ROW',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: TABLE_DESIGN_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Table Design → H toggles header row.',
  },
  {
    id: 'keytips-table-design.total-row',
    bindings: altBinding('KeyJ'),
    sequence: ['KeyT', 'KeyT'],
    description: 'Toggle Total row (Alt+J,T,T)',
    action: 'TOGGLE_TABLE_TOTALS_ROW',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: TABLE_DESIGN_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Table Design → T toggles total row.',
  },
  {
    id: 'keytips-table-design.banded-rows',
    bindings: altBinding('KeyJ'),
    sequence: ['KeyT', 'KeyB'],
    description: 'Toggle Banded rows (Alt+J,T,B)',
    action: 'TOGGLE_TABLE_BANDED_ROWS',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: TABLE_DESIGN_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Table Design → B toggles banded rows.',
  },
];
