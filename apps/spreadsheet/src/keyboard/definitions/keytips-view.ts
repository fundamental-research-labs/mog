/**
 * View Tab Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 View-tab Alt-chord keytips, lifted out of ViewRibbon.tsx
 * `keyTipRegistry.register({ ..., action })` inline closures into typed
 * `KeyboardShortcut` chord entries.
 *
 * `Alt+W` is the View-tab activator (see `ribbon.ts`); the entries below
 * fire after the second-keystroke follow-on.
 *
 * Alt+W,KeyF → Freeze Panes dropdown (OPEN_RIBBON_DROPDOWN: view.freeze-panes)
 * Alt+W,KeyS → Toggle Split (TOGGLE_SPLIT)
 * Alt+W,KeyI → Zoom In (ZOOM_IN)
 * Alt+W,KeyO → Zoom Out (ZOOM_OUT)
 * Alt+W,KeyZ → 100% (zoom reset) (ZOOM_RESET)
 * Alt+W,KeyA → Appearance dropdown (OPEN_RIBBON_DROPDOWN: view.appearance-mode)
 * Alt+W,KeyW → Workbook Settings (OPEN_SPREAD_SETTINGS_DIALOG)
 * Alt+W,KeyT → Sheet Settings (OPEN_SHEET_SETTINGS_DIALOG)
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const VIEW_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_VIEW_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'keytips-view.freeze-panes',
    bindings: altBinding('KeyW'),
    sequence: ['KeyF'],
    description: 'Open Freeze Panes dropdown (Alt+W,F)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'view.freeze-panes' },
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: VIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: View → F opens Freeze Panes dropdown.',
  },
  {
    id: 'keytips-view.split',
    bindings: altBinding('KeyW'),
    sequence: ['KeyS'],
    description: 'Toggle Split (Alt+W,S)',
    action: 'TOGGLE_SPLIT',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: VIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: View → S toggles split.',
  },
  {
    id: 'keytips-view.zoom-in',
    bindings: altBinding('KeyW'),
    sequence: ['KeyI'],
    description: 'Zoom In (Alt+W,I)',
    action: 'ZOOM_IN',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: VIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: View → I zooms in.',
  },
  {
    id: 'keytips-view.zoom-out',
    bindings: altBinding('KeyW'),
    sequence: ['KeyO'],
    description: 'Zoom Out (Alt+W,O)',
    action: 'ZOOM_OUT',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: VIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: View → O zooms out.',
  },
  {
    id: 'keytips-view.zoom-100',
    bindings: altBinding('KeyW'),
    sequence: ['KeyZ'],
    description: 'Reset zoom to 100% (Alt+W,Z)',
    action: 'ZOOM_RESET',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: VIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: View → Z resets zoom to 100%.',
  },
  {
    id: 'keytips-view.appearance',
    bindings: altBinding('KeyW'),
    sequence: ['KeyA'],
    description: 'Open Appearance dropdown (Alt+W,A)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'view.appearance-mode' },
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: VIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Matches the View ribbon Appearance keytip badge.',
  },
  {
    id: 'keytips-view.workbook-settings',
    bindings: altBinding('KeyW'),
    sequence: ['KeyW'],
    description: 'Workbook Settings (Alt+W,W)',
    action: 'OPEN_SPREAD_SETTINGS_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: VIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Opens the workbook settings dialog directly.',
  },
  {
    id: 'keytips-view.sheet-settings',
    bindings: altBinding('KeyW'),
    sequence: ['KeyT'],
    description: 'Sheet Settings (Alt+W,T)',
    action: 'OPEN_SHEET_SETTINGS_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: VIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Opens the sheet settings dialog directly.',
  },
];
