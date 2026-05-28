/**
 * Keytip Picker / Ribbon-Tab Action Handlers (Unified Keytip Router)
 *
 * Handlers backing the typed `KeyboardShortcut` chord entries created by
 * the unified keyboard-mode router migration. Each handler is a
 * pure function over `ActionDependencies` (matching the existing
 * dispatcher contract) that delegates to the corresponding uiStore slice
 * — symmetric with `OPEN_FORMAT_CELLS_DIALOG` etc.
 *
 * The unified action system is the single execution surface; the
 * keytip overlay is a display-only consumer and never invokes these
 * directly.
 *
 */

import type {
  ActionHandler,
  ActionResult,
  RibbonTabId,
  RibbonDropdownPayload,
  SwitchRibbonTabPayload,
} from '@mog-sdk/contracts/actions';

import { getUIStore, handled, notHandled } from '../handler-utils';

// =============================================================================
// SWITCH_RIBBON_TAB — typed chord shortcut entry for `Alt+<letter>` ribbon tabs.
// =============================================================================

/**
 * Activate a ribbon tab. Reads the typed `tabId` from the dispatcher
 * payload (forwarded by the keyboard coordinator from
 * `KeyboardShortcut.actionArg`).
 *
 * Excel keytip semantics: `Alt+H` → Home, `Alt+N` → Insert, `Alt+M` →
 * Formulas, `Alt+A` → Data, `Alt+R` → Review, `Alt+W` → View, `Alt+P`
 * → Page Layout, `Alt+X` → Help. Multi-key
 * contextual chords (`Alt+J,KeyT` → Table Design, `Alt+J,KeyC` →
 * Chart Design) flow through the same handler with a different
 * `tabId`.
 *
 * Note: `Alt+F` does NOT route through this handler. The File
 * affordance is a backstage trigger, not a ribbon tab — `Alt+F`
 * dispatches `OPEN_BACKSTAGE` directly (see
 * `keyboard/definitions/ribbon.ts`).
 */
const OPTIMISTIC_CONTEXTUAL_RIBBON_TABS = new Set<RibbonTabId>([
  'table-design',
  'chart-design',
  'chart-format',
  'picture-tools',
  'slicer-tools',
  'sparkline-tools',
  'diagram-design',
  'diagram-format',
  'pivot-analyze',
  'pivot-design',
]);

export const SWITCH_RIBBON_TAB: ActionHandler = (deps, payload): ActionResult => {
  const arg = payload as SwitchRibbonTabPayload | undefined;
  if (!arg || typeof arg.tabId !== 'string') {
    return notHandled('disabled');
  }
  const store = getUIStore(deps);
  const state = store.getState();

  // Contextual tabs (e.g. 'table-design') are populated asynchronously by
  // useContextualTabs after the selection-coordination bridge call resolves.
  // When a keytip chord fires (Alt+J,T) the async update may not have landed
  // yet, so setActiveRibbonTab would silently reject an otherwise-valid write.
  // Optimistically add only known contextual tab ids so validation passes.
  // Hidden base tabs and removed tab ids must stay rejected by the slice.
  // If the tab doesn't belong (user isn't actually in a table), the next
  // setContextualTabIds call from useContextualTabs will correct it via the
  // atomic two-field transition that resets activeRibbonTab to 'home'.
  const visibleIds = [...state.visibleBaseTabs, ...state.contextualTabIds];
  if (!visibleIds.includes(arg.tabId) && OPTIMISTIC_CONTEXTUAL_RIBBON_TABS.has(arg.tabId)) {
    state.setContextualTabIds([...state.contextualTabIds, arg.tabId]);
  }

  state.setActiveRibbonTab(arg.tabId);
  return handled();
};

// =============================================================================
// Picker open / close handlers (one pair per Home-tab picker slice).
// =============================================================================

export const OPEN_BORDERS_PICKER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openBordersPicker();
  return handled();
};

export const CLOSE_BORDERS_PICKER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeBordersPicker();
  return handled();
};

export const OPEN_FILL_COLOR_PICKER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openFillColorPicker();
  return handled();
};

export const CLOSE_FILL_COLOR_PICKER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeFillColorPicker();
  return handled();
};

export const OPEN_FONT_COLOR_PICKER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openFontColorPicker();
  return handled();
};

export const CLOSE_FONT_COLOR_PICKER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeFontColorPicker();
  return handled();
};

export const OPEN_FONT_FAMILY_PICKER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openFontFamilyPicker();
  return handled();
};

export const CLOSE_FONT_FAMILY_PICKER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeFontFamilyPicker();
  return handled();
};

export const OPEN_NUMBER_FORMAT_DROPDOWN: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openNumberFormatDropdown();
  return handled();
};

export const CLOSE_NUMBER_FORMAT_DROPDOWN: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeNumberFormatDropdown();
  return handled();
};

// =============================================================================
// FOCUS_FONT_SIZE_INPUT — focus-only command, no slice.
// =============================================================================

/**
 * Focus the font size input in the Home/Font ribbon group (Excel
 * `Alt+H,KeyF,KeyS` chord). Implemented as a DOM lookup against the
 * existing `id="font-size-picker"` wrapper — symmetric with the
 * legacy keytip closure but routed through the unified action
 * system. A future change can replace the DOM lookup with a real
 * actor-access focus seam if font-size focus becomes a
 * cross-cutting concern.
 */
export const FOCUS_FONT_SIZE_INPUT: ActionHandler = (): ActionResult => {
  if (typeof document === 'undefined') {
    return notHandled('disabled');
  }
  const el = document.getElementById('font-size-picker');
  if (!el) {
    return notHandled('disabled');
  }
  const input = el.querySelector('input');
  if (!input) {
    return notHandled('disabled');
  }
  input.focus();
  if ('select' in input && typeof input.select === 'function') {
    input.select();
  }
  return handled();
};

// =============================================================================
// OPEN_RIBBON_DROPDOWN / CLOSE_RIBBON_DROPDOWN — generic named-dropdown openers
// =============================================================================

/**
 * Open a named ribbon dropdown.
 *
 * Reads the typed `dropdownId` from the dispatcher payload (forwarded by
 * the keyboard coordinator from `KeyboardShortcut.actionArg`) and writes
 * `true` into the corresponding slot on the `ribbonDropdowns` uiStore
 * slice. Each consuming component renders its dropdown as a controlled
 * `<RibbonDropdown open={...} onOpenChange={...}>` reading from this slot.
 *
 */
export const OPEN_RIBBON_DROPDOWN: ActionHandler = (deps, payload): ActionResult => {
  const arg = payload as RibbonDropdownPayload | undefined;
  if (!arg || typeof arg.dropdownId !== 'string') {
    return notHandled('disabled');
  }
  getUIStore(deps).getState().openRibbonDropdown(arg.dropdownId);
  return handled();
};

export const CLOSE_RIBBON_DROPDOWN: ActionHandler = (deps, payload): ActionResult => {
  const arg = payload as RibbonDropdownPayload | undefined;
  if (!arg || typeof arg.dropdownId !== 'string') {
    return notHandled('disabled');
  }
  getUIStore(deps).getState().closeRibbonDropdown(arg.dropdownId);
  return handled();
};

// =============================================================================
// TRIGGER_AUTOSUM
// =============================================================================

/**
 * Quick-trigger AutoSum on the current selection (Formulas tab Alt+M,A).
 *
 * Looks up the AutoSum button by its DOM id and clicks it. The Formulas
 * ribbon binds the button click to the existing `useAutoSum` hook, which
 * is the same path the inline keytip closure previously took. A future
 * change can replace the DOM lookup with a real actor-access seam if
 * AutoSum becomes a cross-cutting concern.
 */
export const TRIGGER_AUTOSUM: ActionHandler = (): ActionResult => {
  if (typeof document === 'undefined') {
    return notHandled('disabled');
  }
  const button = document.getElementById('formulas-autosum');
  if (!button) {
    return notHandled('disabled');
  }
  if (button instanceof HTMLElement) {
    button.click();
    return handled();
  }
  return notHandled('disabled');
};
