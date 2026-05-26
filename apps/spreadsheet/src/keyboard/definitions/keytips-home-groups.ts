/**
 * Home-Tab Group Keytip Shortcuts (Unified Keytip Router)
 *
 * Excel 365 Home-tab Alt-chord keytips for the **groups** that live on
 * the Home tab (Alignment, Clipboard, Cells, Editing, Styles,
 * Conditional Formatting). Lifted out of the corresponding
 * `*Group.tsx` and `ConditionalFormattingMenu.tsx`
 * `keyTipRegistry.register({ ..., action })` inline closures into
 * typed `KeyboardShortcut` chord entries.
 *
 * `Alt+H` is the Home-tab activator (see `ribbon.ts`); the entries
 * below fire after the second-keystroke (or three-keystroke) follow-on.
 *
 * AlignmentGroup:
 * Alt+H,KeyA,KeyL → Align Left (ALIGN_LEFT)
 * Alt+H,KeyA,KeyC → Align Center (ALIGN_CENTER)
 * Alt+H,KeyA,KeyR → Align Right (ALIGN_RIGHT)
 * Alt+H,KeyA,KeyT → Align Top (ALIGN_TOP)
 * Alt+H,KeyA,KeyM → Align Middle (ALIGN_MIDDLE)
 * Alt+H,KeyA,KeyB → Align Bottom (ALIGN_BOTTOM)
 * Alt+H,KeyW → Toggle Wrap Text (TOGGLE_WRAP_TEXT)
 * Alt+H,KeyM → Merge dropdown (OPEN_RIBBON_DROPDOWN: home.merge)
 * Alt+H,KeyO → Orientation dropdown (OPEN_RIBBON_DROPDOWN: home.orientation)
 * [also: Cells Format dropdown — see Cells group below; matcher
 * priority resolves on stable registration order]
 * Alt+H,Digit5 → Decrease Indent (DECREASE_INDENT)
 * Alt+H,Digit6 → Increase Indent (INCREASE_INDENT)
 *
 * ClipboardGroup:
 * Alt+H,KeyV → Paste (PASTE)
 * Alt+H,KeyX → Cut (CUT)
 * Alt+H,KeyC → Copy (COPY)
 * Alt+H,KeyF,KeyP → Format Painter (START_FORMAT_PAINTER)
 *
 * CellsGroup:
 * Alt+H,KeyI → Insert dropdown (OPEN_RIBBON_DROPDOWN: home.insert)
 * Alt+H,KeyD → Delete dropdown (OPEN_RIBBON_DROPDOWN: home.delete)
 * Alt+H,KeyO → Format dropdown (OPEN_RIBBON_DROPDOWN: home.format)
 *
 * EditingGroup:
 * Alt+H,KeyU → AutoSum dropdown (OPEN_RIBBON_DROPDOWN: home.autosum)
 * Alt+H,KeyF,KeyI → Fill dropdown (OPEN_RIBBON_DROPDOWN: home.fill)
 * Alt+H,KeyE → Clear dropdown (OPEN_RIBBON_DROPDOWN: home.clear)
 * Alt+H,KeyS,KeyO → Sort & Filter dropdown (OPEN_RIBBON_DROPDOWN: home.sort-filter)
 * Alt+H,KeyF,KeyD → Find & Select dropdown (OPEN_RIBBON_DROPDOWN: home.find-select)
 *
 * StylesGroup:
 * Alt+H,KeyL → Format-as-Table dropdown (OPEN_RIBBON_DROPDOWN: home.format-as-table)
 * [also: existing Conditional Formatting chord — `formatting.ts:open-cf-menu`
 * binds Alt+H,KeyL → OPEN_CF_MENU. The CF menu is the canonical Excel target
 * for Alt+H,KeyL; the format-as-table opener uses Alt+H,KeyT instead.]
 * Alt+H,KeyS → Cell Styles dropdown (OPEN_RIBBON_DROPDOWN: home.cell-styles)
 *
 * ConditionalFormattingMenu:
 * Alt+H,KeyJ → Conditional Formatting menu (OPEN_RIBBON_DROPDOWN: home.conditional-formatting)
 *
 */

import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

const HOME_CONTEXTS = ['grid', 'keyTipMode'] as const;

export const KEYTIPS_HOME_GROUPS_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // AlignmentGroup
  // ===========================================================================
  {
    id: 'keytips-home-groups.align-left',
    bindings: altBinding('KeyH'),
    sequence: ['KeyA', 'KeyL'],
    description: 'Align Left (Alt+H,A,L)',
    action: 'SET_HORIZONTAL_ALIGN',
    actionArg: { align: 'left' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → Alignment → AL aligns text left.',
  },
  {
    id: 'keytips-home-groups.align-center',
    bindings: altBinding('KeyH'),
    sequence: ['KeyA', 'KeyC'],
    description: 'Align Center (Alt+H,A,C)',
    action: 'SET_HORIZONTAL_ALIGN',
    actionArg: { align: 'center' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.align-right',
    bindings: altBinding('KeyH'),
    sequence: ['KeyA', 'KeyR'],
    description: 'Align Right (Alt+H,A,R)',
    action: 'SET_HORIZONTAL_ALIGN',
    actionArg: { align: 'right' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.align-top',
    bindings: altBinding('KeyH'),
    sequence: ['KeyA', 'KeyT'],
    description: 'Align Top (Alt+H,A,T)',
    action: 'SET_VERTICAL_ALIGN',
    actionArg: { align: 'top' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.align-middle',
    bindings: altBinding('KeyH'),
    sequence: ['KeyA', 'KeyM'],
    description: 'Align Middle (Alt+H,A,M)',
    action: 'SET_VERTICAL_ALIGN',
    actionArg: { align: 'middle' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.align-bottom',
    bindings: altBinding('KeyH'),
    sequence: ['KeyA', 'KeyB'],
    description: 'Align Bottom (Alt+H,A,B)',
    action: 'SET_VERTICAL_ALIGN',
    actionArg: { align: 'bottom' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.wrap-text',
    bindings: altBinding('KeyH'),
    sequence: ['KeyW'],
    description: 'Toggle Wrap Text (Alt+H,W)',
    action: 'TOGGLE_WRAP_TEXT',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → W toggles word wrap.',
  },
  {
    id: 'keytips-home-groups.merge-dropdown',
    bindings: altBinding('KeyH'),
    sequence: ['KeyM'],
    description: 'Open Merge dropdown (Alt+H,M)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.merge' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → M opens Merge & Center dropdown.',
  },
  {
    id: 'keytips-home-groups.orientation-dropdown',
    bindings: altBinding('KeyH'),
    sequence: ['KeyO'],
    description: 'Open Orientation dropdown (Alt+H,O)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.orientation' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      "Excel 365: Home → O opens Orientation dropdown. (Excel's Cells/Format dropdown has a non-trivial alternate chord; we expose it via Alt+H,KeyO,KeyF or Alt+H,KeyE,KeyT — see CellsGroup keytip notes.)",
  },
  {
    id: 'keytips-home-groups.decrease-indent',
    bindings: altBinding('KeyH'),
    sequence: ['Digit5'],
    description: 'Decrease Indent (Alt+H,5)',
    action: 'DECREASE_INDENT',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.increase-indent',
    bindings: altBinding('KeyH'),
    sequence: ['Digit6'],
    description: 'Increase Indent (Alt+H,6)',
    action: 'INCREASE_INDENT',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // ClipboardGroup
  // ===========================================================================
  {
    id: 'keytips-home-groups.paste',
    bindings: altBinding('KeyH'),
    sequence: ['KeyV'],
    description: 'Paste (Alt+H,V)',
    action: 'PASTE',
    enabled: true,
    priority: 'medium',
    category: 'clipboard',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.cut',
    bindings: altBinding('KeyH'),
    sequence: ['KeyX'],
    description: 'Cut (Alt+H,X)',
    action: 'CUT',
    enabled: true,
    priority: 'medium',
    category: 'clipboard',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.copy',
    bindings: altBinding('KeyH'),
    sequence: ['KeyC'],
    description: 'Copy (Alt+H,C)',
    action: 'COPY',
    enabled: true,
    priority: 'medium',
    category: 'clipboard',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.format-painter',
    bindings: altBinding('KeyH'),
    sequence: ['KeyF', 'KeyP'],
    description: 'Format Painter (Alt+H,F,P)',
    action: 'TOGGLE_FORMAT_PAINTER',
    enabled: true,
    priority: 'medium',
    category: 'clipboard',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel 365: Home → FP starts Format Painter. Uses TOGGLE_FORMAT_PAINTER (reads selection format at call time).',
  },

  // ===========================================================================
  // CellsGroup
  // ===========================================================================
  {
    id: 'keytips-home-groups.cells-insert',
    bindings: altBinding('KeyH'),
    sequence: ['KeyI'],
    description: 'Cells Insert dropdown (Alt+H,I)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.insert' },
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.cells-delete',
    bindings: altBinding('KeyH'),
    sequence: ['KeyD'],
    description: 'Cells Delete dropdown (Alt+H,D)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.delete' },
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.cells-format',
    bindings: altBinding('KeyH'),
    sequence: ['KeyO', 'KeyI'],
    description: 'Cells Format dropdown (Alt+H,O,I)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.format' },
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      "Three-key chord because Alt+H,KeyO already opens the Alignment Orientation dropdown. Excel's actual Cells/Format chord is Alt+H,KeyO,KeyI (Format → I).",
  },

  // ===========================================================================
  // EditingGroup
  // ===========================================================================
  {
    id: 'keytips-home-groups.editing-autosum',
    bindings: altBinding('KeyH'),
    sequence: ['KeyU'],
    description: 'Editing AutoSum dropdown (Alt+H,U)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.autosum' },
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel 365: Home → U opens AutoSum dropdown in Editing group.',
  },
  {
    id: 'keytips-home-groups.editing-fill',
    bindings: altBinding('KeyH'),
    sequence: ['KeyF', 'KeyI'],
    description: 'Editing Fill dropdown (Alt+H,F,I)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.fill' },
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.editing-clear',
    bindings: altBinding('KeyH'),
    sequence: ['KeyE'],
    description: 'Editing Clear dropdown (Alt+H,E)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.clear' },
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.editing-sort-filter',
    bindings: altBinding('KeyH'),
    sequence: ['KeyS', 'KeyO'],
    description: 'Editing Sort & Filter dropdown (Alt+H,S,O)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.sort-filter' },
    enabled: true,
    priority: 'medium',
    category: 'data',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'keytips-home-groups.editing-find-select',
    bindings: altBinding('KeyH'),
    sequence: ['KeyF', 'KeyD'],
    description: 'Editing Find & Select dropdown (Alt+H,F,D)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.find-select' },
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // StylesGroup
  // ===========================================================================
  {
    id: 'keytips-home-groups.format-as-table',
    bindings: altBinding('KeyH'),
    sequence: ['KeyT'],
    description: 'Format as Table dropdown (Alt+H,T)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.format-as-table' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel 365 binds Alt+H,KeyT to Format-as-Table; Alt+H,KeyL is the Conditional Formatting chord (already in formatting.ts:open-cf-menu).',
  },
  {
    id: 'keytips-home-groups.cell-styles',
    bindings: altBinding('KeyH'),
    sequence: ['KeyS'],
    description: 'Cell Styles dropdown (Alt+H,S)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.cell-styles' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // ConditionalFormattingMenu
  // ===========================================================================
  {
    id: 'keytips-home-groups.conditional-formatting',
    bindings: altBinding('KeyH'),
    sequence: ['KeyJ'],
    description: 'Open Conditional Formatting menu (Alt+H,J)',
    action: 'OPEN_RIBBON_DROPDOWN',
    actionArg: { dropdownId: 'home.conditional-formatting' },
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: HOME_CONTEXTS,
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel 365: Home → J opens Conditional Formatting menu. Distinct from formatting.ts:open-cf-menu (Alt+H,L → OPEN_CF_MENU action) which dispatches the legacy backstage path.',
  },
];
