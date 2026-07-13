/**
 * Insert Tab Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 Insert-tab Alt-chord keytips, lifted out of InsertRibbon.tsx
 * `keyTipRegistry.register({ ..., action })` inline closures into typed
 * `KeyboardShortcut` chord entries.
 *
 * `Alt+N` is the Insert-tab activator (see `ribbon.ts`); the entries
 * below fire after the second-keystroke follow-on.
 *
 * Alt+N,KeyT → Insert Table (INSERT_TABLE)
 * Alt+N,KeyP → Insert Picture (INSERT_PICTURE)
 * Alt+N,KeyF → Insert Checkbox (INSERT_FORM_CONTROL_CHECKBOX)
 * Alt+N,KeyB → Insert Combo Box (INSERT_FORM_CONTROL_COMBOBOX)
 * Alt+N,KeyH → Shapes menu (OPEN_RIBBON_DROPDOWN: insert.shapes)
 * Alt+N,KeyC → Insert Column chart (CREATE_EMBEDDED_CHART)
 * Alt+N,KeyK → Sparklines menu (OPEN_RIBBON_DROPDOWN: insert.sparkline)
 * Alt+N,KeyL → Insert Hyperlink (OPEN_HYPERLINK_DIALOG)
 * Alt+N,KeyM → Insert Comment (INSERT_COMMENT)
 * Alt+N,KeyX → Insert Text Box (INSERT_TEXTBOX)
 * Alt+N,KeyW → TextEffect gallery (OPEN_TEXT_EFFECT_GALLERY — also bound directly in object.ts)
 * Alt+N,KeyE → Insert Equation (INSERT_EQUATION)
 *
 * Note: `Alt+N,KeyW → OPEN_TEXT_EFFECT_GALLERY` is already declared in
 * `keyboard/definitions/object.ts`; no duplicate
 * entry here.
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const INSERT_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_INSERT_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'keytips-insert.table',
    bindings: altBinding('KeyN'),
    sequence: ['KeyT'],
    description: 'Insert Table (Alt+N,T)',
    action: 'INSERT_TABLE',
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Insert → T inserts a Table from selection.',
  },
  {
    id: 'keytips-insert.picture',
    bindings: altBinding('KeyN'),
    sequence: ['KeyP'],
    description: 'Insert Picture (Alt+N,P)',
    action: 'INSERT_PICTURE',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Insert → P opens image selection and inserts a picture.',
  },
  {
    id: 'keytips-insert.form-control-checkbox',
    bindings: altBinding('KeyN'),
    sequence: ['KeyF'],
    description: 'Insert Checkbox Form Control (Alt+N,F)',
    action: 'INSERT_FORM_CONTROL_CHECKBOX',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Insert tab form-control shortcut for a linked checkbox.',
  },
  {
    id: 'keytips-insert.form-control-combobox',
    bindings: altBinding('KeyN'),
    sequence: ['KeyB'],
    description: 'Insert Combo Box Form Control (Alt+N,B)',
    action: 'INSERT_FORM_CONTROL_COMBOBOX',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Insert tab form-control shortcut for a linked combo box.',
  },
  {
    id: 'keytips-insert.shapes',
    bindings: altBinding('KeyN'),
    sequence: ['KeyH'],
    description: 'Open Shapes menu (Alt+N,H)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'insert.shapes' },
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Insert → H opens Shapes gallery menu.',
  },
  {
    id: 'keytips-insert.chart',
    bindings: altBinding('KeyN'),
    sequence: ['KeyC'],
    description: 'Insert Column chart (Alt+N,C)',
    action: 'CREATE_EMBEDDED_CHART',
    actionArg: { sourceRangeMode: 'selected-range' },
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel 365: Insert → C inserts a default Column chart from selection. Mirrors InsertRibbon onClick.',
  },
  {
    id: 'keytips-insert.sparkline',
    bindings: altBinding('KeyN'),
    sequence: ['KeyK'],
    description: 'Open Sparklines menu (Alt+N,K)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'insert.sparkline' },
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Insert → K opens Sparklines (Line / Column / Win-Loss) menu.',
  },
  {
    id: 'keytips-insert.hyperlink',
    bindings: altBinding('KeyN'),
    sequence: ['KeyL'],
    description: 'Insert Hyperlink (Alt+N,L)',
    action: 'OPEN_HYPERLINK_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Insert → L opens Hyperlink dialog.',
  },
  {
    id: 'keytips-insert.comment',
    bindings: altBinding('KeyN'),
    sequence: ['KeyM'],
    description: 'Insert Comment (Alt+N,M)',
    action: 'INSERT_COMMENT',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Insert → M inserts comment on active cell.',
  },
  {
    id: 'keytips-insert.textbox',
    bindings: altBinding('KeyN'),
    sequence: ['KeyX'],
    description: 'Insert Text Box (Alt+N,X)',
    action: 'INSERT_TEXTBOX',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Insert → X inserts Text Box.',
  },
  {
    id: 'keytips-insert.equation',
    bindings: altBinding('KeyN'),
    sequence: ['KeyE'],
    description: 'Insert Equation (Alt+N,E)',
    action: 'INSERT_EQUATION',
    enabled: true,
    priority: 'medium',
    category: 'object',
    contexts: INSERT_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Mog Insert ribbon advertises Alt+N,E for Equation; route that visible keytip to the equation editor.',
  },
];
