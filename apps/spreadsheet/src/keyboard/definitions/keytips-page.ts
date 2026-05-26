/**
 * Page Tab Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 Page Layout-tab Alt-chord keytips, lifted out of
 * PageSetupGroup.tsx `keyTipRegistry.register({ ..., action })` inline
 * closures into typed `KeyboardShortcut` chord entries.
 *
 * `Alt+P` is the Page-tab activator (see `ribbon.ts`); the entries below
 * fire after the second-keystroke follow-on. The dropdown id namespace
 * is `page.*` (matches the tab id); the user-visible label remains
 * "Page Layout" — only the internal id namespace was unified.
 *
 * Alt+P,KeyM → Margins dropdown (OPEN_RIBBON_DROPDOWN: page.margins)
 * Alt+P,KeyO → Orientation dropdown (OPEN_RIBBON_DROPDOWN: page.orientation)
 * Alt+P,KeyS → Size dropdown (OPEN_RIBBON_DROPDOWN: page.size)
 * Alt+P,KeyA → Print Area dropdown (OPEN_RIBBON_DROPDOWN: page.print-area)
 * Alt+P,KeyB → Page Breaks dropdown (OPEN_RIBBON_DROPDOWN: page.breaks)
 * Alt+P,KeyT → Print Titles (OPEN_PAGE_SETUP_DIALOG: initialTab=sheet)
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const PAGE_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_PAGE_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'keytips-page.margins',
    bindings: altBinding('KeyP'),
    sequence: ['KeyM'],
    description: 'Open Margins dropdown (Alt+P,M)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'page.margins' },
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: PAGE_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Page Layout → M opens Margins dropdown.',
  },
  {
    id: 'keytips-page.orientation',
    bindings: altBinding('KeyP'),
    sequence: ['KeyO'],
    description: 'Open Orientation dropdown (Alt+P,O)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'page.orientation' },
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: PAGE_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-page.size',
    bindings: altBinding('KeyP'),
    sequence: ['KeyS'],
    description: 'Open Size dropdown (Alt+P,S)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'page.size' },
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: PAGE_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-page.print-area',
    bindings: altBinding('KeyP'),
    sequence: ['KeyA'],
    description: 'Open Print Area dropdown (Alt+P,A)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'page.print-area' },
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: PAGE_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-page.breaks',
    bindings: altBinding('KeyP'),
    sequence: ['KeyB'],
    description: 'Open Page Breaks dropdown (Alt+P,B)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'page.breaks' },
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: PAGE_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-page.print-titles',
    bindings: altBinding('KeyP'),
    sequence: ['KeyT'],
    description: 'Print Titles (Alt+P,T)',
    action: 'OPEN_PAGE_SETUP_DIALOG',
    actionArg: { initialTab: 'sheet' },
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: PAGE_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Page Layout → T opens Print Titles dialog.',
  },
];
