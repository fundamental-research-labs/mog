/**
 * Review Tab Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 Review-tab Alt-chord keytips, lifted out of ReviewRibbon.tsx
 * `keyTipRegistry.register({ ..., action })` inline closures into typed
 * `KeyboardShortcut` chord entries.
 *
 * `Alt+R` is the Review-tab activator (see `ribbon.ts`); the entries below
 * fire after the second-keystroke follow-on.
 *
 * Alt+R,KeyC → New Comment (INSERT_COMMENT)
 * Alt+R,KeyD → Delete Comment (DELETE_COMMENT)
 * Alt+R,KeyP → Previous Comment (PREVIOUS_COMMENT)
 * Alt+R,KeyN → Next Comment (NEXT_COMMENT)
 * Alt+R,KeyA → Toggle Show All Comments (TOGGLE_SHOW_ALL_COMMENTS)
 * Alt+R,KeyS → Protect Sheet (TOGGLE_SHEET_PROTECTION)
 * Alt+R,KeyW → Protect Workbook (OPEN_PROTECT_WORKBOOK_DIALOG)
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const REVIEW_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_REVIEW_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'keytips-review.new-comment',
    bindings: altBinding('KeyR'),
    sequence: ['KeyC'],
    description: 'Insert new comment (Alt+R,C)',
    action: 'INSERT_COMMENT',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: REVIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Review → C inserts a new comment.',
  },
  {
    id: 'keytips-review.delete-comment',
    bindings: altBinding('KeyR'),
    sequence: ['KeyD'],
    description: 'Delete comment (Alt+R,D)',
    action: 'DELETE_COMMENT',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: REVIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Review → D deletes comment(s) on active cell.',
  },
  {
    id: 'keytips-review.prev-comment',
    bindings: altBinding('KeyR'),
    sequence: ['KeyP'],
    description: 'Previous comment (Alt+R,P)',
    action: 'PREVIOUS_COMMENT',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: REVIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Review → P navigates to previous comment.',
  },
  {
    id: 'keytips-review.next-comment',
    bindings: altBinding('KeyR'),
    sequence: ['KeyN'],
    description: 'Next comment (Alt+R,N)',
    action: 'NEXT_COMMENT',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: REVIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Review → N navigates to next comment.',
  },
  {
    id: 'keytips-review.toggle-all-comments',
    bindings: altBinding('KeyR'),
    sequence: ['KeyA'],
    description: 'Toggle Show All Comments (Alt+R,A)',
    action: 'TOGGLE_SHOW_ALL_COMMENTS',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: REVIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Review → A toggles visibility of all comments.',
  },
  {
    id: 'keytips-review.protect-sheet',
    bindings: altBinding('KeyR'),
    sequence: ['KeyS'],
    description: 'Protect / Unprotect sheet (Alt+R,S)',
    action: 'TOGGLE_SHEET_PROTECTION',
    enabled: true,
    priority: 'medium',
    category: 'workbook',
    contexts: REVIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel 365: Review → S toggles sheet protection. Dispatches TOGGLE_SHEET_PROTECTION which decides between OPEN_PROTECT_SHEET_DIALOG and UNPROTECT_SHEET.',
  },
  {
    id: 'keytips-review.protect-workbook',
    bindings: altBinding('KeyR'),
    sequence: ['KeyW'],
    description: 'Protect / Unprotect workbook (Alt+R,W)',
    action: 'OPEN_PROTECT_WORKBOOK_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'workbook',
    contexts: REVIEW_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel 365: Review → W toggles workbook structure protection through the current Protect Workbook command state.',
  },
];
