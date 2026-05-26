/**
 * Home Tab Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 Home-tab Alt-chord keytips, lifted out of FontGroup.tsx
 * and NumberGroup.tsx `keyTipRegistry.register({ ..., action })`
 * inline closures into typed `KeyboardShortcut` chord entries.
 *
 * Excel mapping (verified against Excel 365):
 * Font group:
 * Alt+H,Digit1 → Bold (TOGGLE_BOLD)
 * Alt+H,Digit2 → Italic (TOGGLE_ITALIC)
 * Alt+H,Digit3 → Underline (TOGGLE_UNDERLINE)
 * Alt+H,Digit4 → Strikethrough (TOGGLE_STRIKETHROUGH)
 * Alt+H,KeyB → Borders dropdown (OPEN_BORDERS_PICKER)
 * Alt+H,KeyH → Highlight (fill) (OPEN_FILL_COLOR_PICKER)
 * Alt+H,KeyF,KeyC → Font color (OPEN_FONT_COLOR_PICKER)
 * Alt+H,KeyF,KeyF → Font family (OPEN_FONT_FAMILY_PICKER)
 * Alt+H,KeyF,KeyS → Focus size box (FOCUS_FONT_SIZE_INPUT)
 *
 * Number group:
 * Alt+H,KeyN,KeyF → Number-format dropdown (OPEN_NUMBER_FORMAT_DROPDOWN)
 * Alt+H,Shift+Digit4 → $ Currency (FORMAT_CURRENCY)
 * Alt+H,KeyP → % Percentage (FORMAT_PERCENTAGE)
 * Alt+H,KeyK → , Comma (FORMAT_COMMA)
 * Alt+H,Digit0 → Increase decimals (INCREASE_DECIMALS)
 * Alt+H,Digit9 → Decrease decimals (DECREASE_DECIMALS)
 *
 * The KeyTip overlay reads its display labels from `keyTipRegistry`
 * (which keeps `{ key, tabId, elementId, label? }` only — no
 * `action` field), so the visual badge layer is unaffected by this
 * routing change.
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const HOME_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_HOME_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Font group
  // ===========================================================================
  {
    id: 'keytips-home.bold',
    bindings: altBinding('KeyH'),
    sequence: ['Digit1'],
    description: 'Bold (Alt+H,1)',
    action: 'TOGGLE_BOLD',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Excel 365: Home → 1 toggles bold.',
  },
  {
    id: 'keytips-home.italic',
    bindings: altBinding('KeyH'),
    sequence: ['Digit2'],
    description: 'Italic (Alt+H,2)',
    action: 'TOGGLE_ITALIC',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Excel 365: Home → 2 toggles italic.',
  },
  {
    id: 'keytips-home.underline',
    bindings: altBinding('KeyH'),
    sequence: ['Digit3'],
    description: 'Underline (Alt+H,3)',
    action: 'TOGGLE_UNDERLINE',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Excel 365: Home → 3 toggles underline.',
  },
  {
    id: 'keytips-home.strikethrough',
    bindings: altBinding('KeyH'),
    sequence: ['Digit4'],
    description: 'Strikethrough (Alt+H,4)',
    action: 'TOGGLE_STRIKETHROUGH',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → 4 toggles strikethrough.',
  },
  {
    id: 'keytips-home.borders',
    bindings: altBinding('KeyH'),
    sequence: ['KeyB'],
    description: 'Open Borders dropdown (Alt+H,B)',
    action: 'OPEN_BORDERS_PICKER',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → B opens Borders dropdown.',
  },
  {
    id: 'keytips-home.fill-color',
    bindings: altBinding('KeyH'),
    sequence: ['KeyH'],
    description: 'Open Fill Color (Highlight) picker (Alt+H,H)',
    action: 'OPEN_FILL_COLOR_PICKER',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → H opens fill-color (highlight) picker.',
  },
  {
    id: 'keytips-home.font-color',
    bindings: altBinding('KeyH'),
    sequence: ['KeyF', 'KeyC'],
    description: 'Open Font Color picker (Alt+H,F,C)',
    action: 'OPEN_FONT_COLOR_PICKER',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → Font → Color (three-key chord).',
  },
  {
    id: 'keytips-home.font-family',
    bindings: altBinding('KeyH'),
    sequence: ['KeyF', 'KeyF'],
    description: 'Open Font Family picker (Alt+H,F,F)',
    action: 'OPEN_FONT_FAMILY_PICKER',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → Font → Family (three-key chord).',
  },
  {
    id: 'keytips-home.focus-font-size',
    bindings: altBinding('KeyH'),
    sequence: ['KeyF', 'KeyS'],
    description: 'Focus Font Size input (Alt+H,F,S)',
    action: 'FOCUS_FONT_SIZE_INPUT',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → Font → Size (focuses size selector).',
  },

  // ===========================================================================
  // Number group
  // ===========================================================================
  {
    id: 'keytips-home.number-format-dropdown',
    bindings: altBinding('KeyH'),
    // Excel 365 canonical: Alt+H,N opens the Number Format dropdown
    // (two-key chord). The earlier three-key form `Alt+H,N,F` was an
    // implementation artifact; reconciliation pinned the chord to the
    // canonical two-key shape.
    sequence: ['KeyN'],
    description: 'Open Number Format dropdown (Alt+H,N)',
    action: 'OPEN_NUMBER_FORMAT_DROPDOWN',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → N opens Number-format dropdown (two-key chord).',
  },
  {
    id: 'keytips-home.format-currency',
    bindings: altBinding('KeyH'),
    // Excel's `Alt+H,$` = `Alt+H,Shift+Digit4` on a US keyboard.
    sequence: [{ code: 'Digit4', shift: true }],
    description: 'Currency format (Alt+H,$ → Shift+Digit4)',
    action: 'FORMAT_CURRENCY',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → $ applies currency format.',
  },
  {
    id: 'keytips-home.format-percentage',
    bindings: altBinding('KeyH'),
    sequence: ['KeyP'],
    description: 'Percentage format (Alt+H,P)',
    action: 'FORMAT_PERCENTAGE',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → P applies percentage format.',
  },
  {
    id: 'keytips-home.format-comma',
    bindings: altBinding('KeyH'),
    sequence: ['KeyK'],
    description: 'Comma (thousands) format (Alt+H,K)',
    action: 'FORMAT_COMMA',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → K applies comma (thousands) format.',
  },
  {
    id: 'keytips-home.increase-decimals',
    bindings: altBinding('KeyH'),
    sequence: ['Digit0'],
    description: 'Increase decimals (Alt+H,0)',
    action: 'INCREASE_DECIMALS',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → 0 increases displayed decimals.',
  },
  {
    id: 'keytips-home.decrease-decimals',
    bindings: altBinding('KeyH'),
    sequence: ['Digit9'],
    description: 'Decrease decimals (Alt+H,9)',
    action: 'DECREASE_DECIMALS',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → 9 decreases displayed decimals.',
  },
];
