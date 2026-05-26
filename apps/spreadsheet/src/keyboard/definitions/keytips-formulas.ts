/**
 * Formulas Tab Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 Formulas-tab Alt-chord keytips, lifted out of
 * FormulasRibbon.tsx `keyTipRegistry.register({ ..., action })` inline
 * closures into typed `KeyboardShortcut` chord entries.
 *
 * `Alt+M` is the Formulas-tab activator (see `ribbon.ts`); the entries
 * below fire after the second-keystroke follow-on.
 *
 * Alt+M,KeyI → Insert Function dialog (OPEN_INSERT_FUNCTION_DIALOG)
 * Alt+M,KeyA → AutoSum (quick trigger) (AUTO_SUM)
 * Alt+M,KeyF → Financial dropdown (OPEN_RIBBON_DROPDOWN: formulas.financial)
 * Alt+M,KeyL → Logical dropdown (OPEN_RIBBON_DROPDOWN: formulas.logical)
 * Alt+M,KeyT → Text dropdown (OPEN_RIBBON_DROPDOWN: formulas.text)
 * Alt+M,KeyD → Date & Time dropdown (OPEN_RIBBON_DROPDOWN: formulas.date-time)
 * Alt+M,KeyG → Math & Trig dropdown (OPEN_RIBBON_DROPDOWN: formulas.math-trig)
 * Alt+M,KeyN → Name Manager (OPEN_NAME_MANAGER)
 * Alt+M,KeyE → Define Name (OPEN_DEFINE_NAME_DIALOG)
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const FORMULAS_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_FORMULAS_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'keytips-formulas.insert-function',
    bindings: altBinding('KeyM'),
    sequence: ['KeyI'],
    description: 'Open Insert Function dialog (Alt+M,I)',
    action: 'OPEN_INSERT_FUNCTION_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Formulas → I opens Insert Function dialog.',
  },
  {
    id: 'keytips-formulas.autosum',
    bindings: altBinding('KeyM'),
    sequence: ['KeyA'],
    description: 'AutoSum (Alt+M,A)',
    action: 'AUTO_SUM',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel 365: Formulas → A triggers AutoSum on selection. Dispatches AUTO_SUM directly (no DOM dependency).',
  },
  {
    id: 'keytips-formulas.financial',
    bindings: altBinding('KeyM'),
    sequence: ['KeyF'],
    description: 'Financial functions dropdown (Alt+M,F)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'formulas.financial' },
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Formulas → F opens Financial functions menu.',
  },
  {
    id: 'keytips-formulas.logical',
    bindings: altBinding('KeyM'),
    sequence: ['KeyL'],
    description: 'Logical functions dropdown (Alt+M,L)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'formulas.logical' },
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Formulas → L opens Logical functions menu.',
  },
  {
    id: 'keytips-formulas.text',
    bindings: altBinding('KeyM'),
    sequence: ['KeyT'],
    description: 'Text functions dropdown (Alt+M,T)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'formulas.text' },
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Formulas → T opens Text functions menu.',
  },
  {
    id: 'keytips-formulas.date-time',
    bindings: altBinding('KeyM'),
    sequence: ['KeyD'],
    description: 'Date & Time functions dropdown (Alt+M,D)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'formulas.date-time' },
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Formulas → D opens Date & Time menu.',
  },
  {
    id: 'keytips-formulas.math-trig',
    bindings: altBinding('KeyM'),
    sequence: ['KeyG'],
    description: 'Math & Trig functions dropdown (Alt+M,G)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'formulas.math-trig' },
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Formulas → G opens Math & Trig menu.',
  },
  {
    id: 'keytips-formulas.name-manager',
    bindings: altBinding('KeyM'),
    sequence: ['KeyN'],
    description: 'Name Manager (Alt+M,N)',
    action: 'OPEN_NAME_MANAGER',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Formulas → N opens Name Manager.',
  },
  {
    id: 'keytips-formulas.define-name',
    bindings: altBinding('KeyM'),
    sequence: ['KeyE'],
    description: 'Define Name (Alt+M,E)',
    action: 'OPEN_DEFINE_NAME_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: FORMULAS_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Formulas → E opens Define Name dialog.',
  },
];
