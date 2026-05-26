/**
 * Conditional Formatting Action Handlers
 *
 * Pure handler functions for CF operations.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - CRUD handlers are async functions: (deps, payload?) => Promise<ActionResult>
 * - CF CRUD actions go through the Worksheet API (ws.addConditionalFormat, etc.)
 * - Dialog open/close actions write directly to UIStore (cfDialog slice)
 *
 * This file handles:
 * - CREATE_CF_RULE - Create a new CF rule
 * - UPDATE_CF_RULE - Update an existing CF rule
 * - DELETE_CF_RULE - Delete a CF rule
 * - REORDER_CF_RULES - Reorder CF rules (change priority)
 * - OPEN_CF_RULES_MANAGER - Open the CF rules manager dialog
 * - CLOSE_CF_RULES_MANAGER - Close the CF rules manager dialog
 * - OPEN_CF_DIALOG - Open the new rule dialog
 * - CLOSE_CF_DIALOG - Close the new rule dialog
 * - OPEN_CF_MENU - Open CF dropdown menu (keyboard shortcut)
 *
 * All CF CRUD operations now go through the unified Worksheet API.
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { CFRuleInput } from '@mog-sdk/contracts/api';

import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// CF Rule CRUD Actions
// =============================================================================

/**
 * CREATE_CF_RULE - Create a new conditional formatting rule.
 * Payload: {
 * sheetId: string,
 * ranges: CFCellRange[],
 * rule: Omit<CFRule, 'id'>
 * }
 *
 * Creates a new ConditionalFormat with the provided rule.
 * Uses the Worksheet API for the underlying operation.
 */
export const CREATE_CF_RULE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const sheetId = payload?.sheetId ?? deps.getActiveSheetId();
  const ranges = payload?.ranges as
    | Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>
    | undefined;
  const ruleData = payload?.rule as CFRuleInput | undefined;

  if (!ranges || ranges.length === 0) {
    return { handled: false, error: 'Missing ranges in payload' };
  }

  if (!ruleData) {
    return { handled: false, error: 'Missing rule in payload' };
  }

  const ws = deps.workbook.getSheetById(sheetId);

  try {
    // New format-level API: pass ranges and rules separately.
    // ruleData is already CFRuleInput-shaped (rule config without id/priority).
    await ws.conditionalFormats.add(ranges, [ruleData]);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * UPDATE_CF_RULE - Update an existing conditional formatting rule.
 * Payload: {
 * sheetId?: string,
 * formatId: string,
 * ruleId: string,
 * updates: Partial<CFRule>
 * }
 *
 * Uses the Worksheet API for the underlying operation.
 */
export const UPDATE_CF_RULE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const sheetId = payload?.sheetId ?? deps.getActiveSheetId();
  const formatId = payload?.formatId as string | undefined;
  const ruleId = payload?.ruleId as string | undefined;
  const updates = payload?.updates as Record<string, any> | undefined;

  if (!formatId) {
    return { handled: false, error: 'Missing formatId in payload' };
  }

  if (!ruleId) {
    return { handled: false, error: 'Missing ruleId in payload' };
  }

  if (!updates) {
    return { handled: false, error: 'Missing updates in payload' };
  }

  const ws = deps.workbook.getSheetById(sheetId);

  try {
    // Format-level API: get the current format, apply updates to the target rule,
    // then pass back the full rules array.
    const format = await ws.conditionalFormats.get(formatId);
    if (!format) {
      return { handled: false, error: `Format ${formatId} not found` };
    }
    // Apply updates to the specific rule within the format
    const updatedRules = format.rules.map((r) => (r.id === ruleId ? { ...r, ...updates } : r));
    await ws.conditionalFormats.update(formatId, { rules: updatedRules });
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * DELETE_CF_RULE - Delete a conditional formatting rule.
 * Payload: {
 * sheetId?: string,
 * formatId: string,
 * ruleId?: string // If not provided, uses formatId as the identifier
 * }
 *
 * Uses the Worksheet API for the underlying operation.
 */
export const DELETE_CF_RULE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const sheetId = payload?.sheetId ?? deps.getActiveSheetId();
  const formatId = payload?.formatId as string | undefined;
  const ruleId = payload?.ruleId as string | undefined;

  if (!formatId) {
    return { handled: false, error: 'Missing formatId in payload' };
  }

  const ws = deps.workbook.getSheetById(sheetId);

  try {
    if (ruleId) {
      await ws.conditionalFormats.removeRule(formatId, ruleId);
    } else {
      await ws.conditionalFormats.remove(formatId);
    }
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

/**
 * REORDER_CF_RULES - Reorder CF rules by changing their priorities.
 * Payload: {
 * sheetId?: string,
 * formatId: string,
 * ruleOrder: { ruleId: string, priority: number }[]
 * }
 *
 * Uses the Worksheet API for the underlying operation.
 */
export const REORDER_CF_RULES: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const sheetId = payload?.sheetId ?? deps.getActiveSheetId();
  const ruleOrder = payload?.ruleOrder as Array<{ ruleId: string; priority: number }> | undefined;

  if (!ruleOrder || ruleOrder.length === 0) {
    return { handled: false, error: 'Missing ruleOrder in payload' };
  }

  const ws = deps.workbook.getSheetById(sheetId);

  try {
    const ruleIds = ruleOrder.map((r) => r.ruleId);
    await ws.conditionalFormats.reorder(ruleIds);
  } catch (e: any) {
    return { handled: false, error: e.message ?? String(e) };
  }

  return handled();
};

// =============================================================================
// CF Dialog Actions
// =============================================================================

/**
 * OPEN_CF_RULES_MANAGER - Open the Conditional Formatting Rules Manager dialog.
 * No payload required.
 *
 * routes through the UIStore slice
 * (`cfDialog.rulesManagerOpen`) instead of the legacy stringly-typed
 * UI escape hatch. The slice's alias `openCFRulesManager`
 * mirrors the action name so the call site stays self-documenting.
 */
export const OPEN_CF_RULES_MANAGER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().openCFRulesManager();
  return handled();
};

/**
 * CLOSE_CF_RULES_MANAGER - Close the Conditional Formatting Rules Manager dialog.
 * No payload required.
 *
 * see OPEN_CF_RULES_MANAGER.
 */
export const CLOSE_CF_RULES_MANAGER: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeCFRulesManager();
  return handled();
};

/**
 * OPEN_CF_DIALOG - Open the New Formatting Rule dialog.
 * Payload: { ruleType?: CFRuleType } - Optional preset rule type
 *
 * routes through the UIStore slice
 * (`openCFDialog` opens `cfDialog.isOpen` and sets `selectedRuleType`).
 */
export const OPEN_CF_DIALOG: ActionHandler = (deps, payload): ActionResult => {
  const ruleType = payload?.ruleType;
  // openCFDialog accepts (mode, format); the optional `ruleType` payload is
  // captured by setting it after open. Default mode is 'create'.
  getUIStore(deps).getState().openCFDialog('create');
  if (ruleType) {
    getUIStore(deps).getState().setCFRuleType(ruleType);
  }
  return handled();
};

/**
 * CLOSE_CF_DIALOG - Close the New Formatting Rule dialog.
 * No payload required.
 *
 * routes through the UIStore slice.
 */
export const CLOSE_CF_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeCFDialog();
  return handled();
};

/**
 * OPEN_CF_MENU - Open the Conditional Formatting dropdown menu.
 * Triggered by the `Alt+H,L` keyboard shortcut.
 *
 * Bug fix: The previous implementation depended on the legacy
 * stringly-typed UI escape hatch, which the spreadsheet host does not
 * wire on web. The handler returned `notHandled('disabled')` and the
 * keyboard pipeline reported handled=false, so the browser's default
 * routed `KeyL` straight into the cell editor.
 *
 * Symmetric with `OPEN_FILL_COLOR_PICKER` and `OPEN_RIBBON_DROPDOWN`
 *: write the open-state directly into the uiStore. The
 * Conditional Formatting menu reads `ribbonDropdowns['home.conditional-formatting']`
 * (see `chrome/toolbar/galleries/ConditionalFormattingMenu.tsx`), so the
 * dropdown opens when this slot flips to `true`.
 *
 * No payload required.
 */
export const OPEN_CF_MENU: ActionHandler = (deps): ActionResult => {
  // uiStore is required for ActionDependencies and is always present in
  // production wiring (`buildActionDependencies` short-circuits when it
  // isn't). Use `getUIStore` for the typed accessor — symmetric with
  // other ribbon-dropdown openers.
  if (!deps.uiStore) {
    return notHandled('disabled');
  }
  getUIStore(deps).getState().openRibbonDropdown('home.conditional-formatting');
  return handled();
};
