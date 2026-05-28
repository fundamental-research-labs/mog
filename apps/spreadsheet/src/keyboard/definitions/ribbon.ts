/**
 * Ribbon Tab-Switch Keyboard Shortcuts (Unified Keytip Router)
 *
 * Excel's Alt-letter ribbon tab keytips, lifted from the old
 * `keyTipRegistry.register({ ..., action: () => onTabChange(...) })`
 * inline closure on TabBar.tsx into typed `KeyboardShortcut` entries.
 *
 * Excel 365 mapping:
 * Alt+F → OPEN_BACKSTAGE (not a tab — backstage trigger, see entry below)
 * Alt+H → home
 * Alt+N → insert
 * Alt+P → page
 * Alt+M → formulas
 * Alt+A → data
 * Alt+R → review
 * Alt+W → view
 * Alt+J,T → table-design (contextual, two-key chord)
 * Alt+J,C → chart-design (contextual, two-key chord)
 * Alt+J,F → chart-format (contextual, two-key chord)
 *
 * Each entry fires `SWITCH_RIBBON_TAB` with `actionArg: { tabId }` —
 * the typed payload threads from contract → coordinator → dispatcher
 * → handler → uiStore slice. The `'keyTipMode'` context lets these
 * fire after an Alt-tap (mode entered by the coordinator's Alt-tap
 * detector) as well as from a plain `Alt+letter` chord-start.
 *
 */

import type { RibbonTabId } from '../../actions';
import type { KeyboardShortcut } from '../types';
import { altBinding } from '@mog-sdk/kernel/keyboard';

/**
 * Helper: build a ribbon-tab-switch shortcut entry.
 *
 * Single-key Alt+letter shortcuts (the common case) leave `sequence`
 * absent; two-key contextual chords (`Alt+J,KeyT`) pass the follow-on
 * codes via the `sequence` argument.
 */
function ribbonTabShortcut(args: {
  id: string;
  bindings: ReturnType<typeof altBinding>;
  description: string;
  tabId: RibbonTabId;
  sequence?: readonly ('KeyT' | 'KeyC' | 'KeyF' | 'KeyY' | 'KeyV')[];
}): KeyboardShortcut<'SWITCH_RIBBON_TAB'> {
  return {
    id: args.id,
    bindings: args.bindings,
    description: args.description,
    action: 'SWITCH_RIBBON_TAB',
    actionArg: { tabId: args.tabId },
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    // Both 'grid' (Alt+letter starts the chord directly) and
    // 'keyTipMode' (Alt-tap entered keytip mode, then letter is the
    // first chord token) are valid entry contexts.
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    sequence: args.sequence,
    notes:
      ' unified keytip router: replaces TabBar.tsx ' +
      '`keyTipRegistry.register({ action: () => onTabChange(...) })` closure.',
  };
}

export const RIBBON_SHORTCUTS: KeyboardShortcut[] = [
  // Alt+F: retargeted from `SWITCH_RIBBON_TAB('file')` to `OPEN_BACKSTAGE`
  // directly. The File affordance is a backstage trigger, not a ribbon
  // tab; routing it through `activeRibbonTab` was a signaling-channel
  // hack that produced a multi-write cascade. See
  {
    id: 'ribbon.open-backstage',
    bindings: altBinding('KeyF'),
    description: 'Open File backstage',
    action: 'OPEN_BACKSTAGE',
    enabled: true,
    priority: 'medium',
    category: 'file',
    // Both 'grid' (Alt+letter starts the chord directly) and
    // 'keyTipMode' (Alt-tap entered keytip mode, then F is the first
    // chord token) are valid entry contexts.
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  ribbonTabShortcut({
    id: 'ribbon.switch-home',
    bindings: altBinding('KeyH'),
    description: 'Switch to Home tab',
    tabId: 'home',
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-insert',
    bindings: altBinding('KeyN'),
    description: 'Switch to Insert tab',
    tabId: 'insert',
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-page',
    bindings: altBinding('KeyP'),
    description: 'Switch to Page Layout tab',
    // Tab id and shortcut id are both `page` (matches BASE_TABS and the
    // dropdown id namespace `page.*`). The user-visible label remains
    // "Page Layout" — only internal ids were unified.
    tabId: 'page',
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-formulas',
    bindings: altBinding('KeyM'),
    description: 'Switch to Formulas tab',
    tabId: 'formulas',
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-data',
    bindings: altBinding('KeyA'),
    description: 'Switch to Data tab',
    tabId: 'data',
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-review',
    bindings: altBinding('KeyR'),
    description: 'Switch to Review tab',
    tabId: 'review',
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-view',
    bindings: altBinding('KeyW'),
    description: 'Switch to View tab',
    tabId: 'view',
  }),
  // Contextual two-key chords (J → table-design / chart-design).
  ribbonTabShortcut({
    id: 'ribbon.switch-table-design',
    bindings: altBinding('KeyJ'),
    description: 'Switch to Table Design tab (contextual)',
    tabId: 'table-design',
    sequence: ['KeyT'],
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-chart-design',
    bindings: altBinding('KeyJ'),
    description: 'Switch to Chart Design tab (contextual)',
    tabId: 'chart-design',
    sequence: ['KeyC'],
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-chart-format',
    bindings: altBinding('KeyJ'),
    description: 'Switch to Chart Format tab (contextual)',
    tabId: 'chart-format',
    sequence: ['KeyF'],
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-pivot-analyze',
    bindings: altBinding('KeyJ'),
    description: 'Switch to PivotTable Analyze tab (contextual)',
    tabId: 'pivot-analyze',
    sequence: ['KeyY'],
  }),
  ribbonTabShortcut({
    id: 'ribbon.switch-pivot-design',
    bindings: altBinding('KeyJ'),
    description: 'Switch to PivotTable Design tab (contextual)',
    tabId: 'pivot-design',
    sequence: ['KeyV'],
  }),
];
