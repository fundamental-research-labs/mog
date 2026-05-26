/**
 * AutoFill Options Button Handlers
 *
 * Shows/hides the autofill options button after a fill operation
 * and handles re-executing fill with different options.
 *
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import type { FillOptions } from '../../../domain/fill/types';
import {
  buildFillOptionsFromOption,
  type AutoFillOptionType,
} from '../../../ui-store/slices/editing/autofill-options';
import { executeFillViaWorksheet, getUIStore, handled } from './types';

// =============================================================================
// AutoFill Options Button
// =============================================================================

/**
 * SHOW_AUTOFILL_OPTIONS
 *
 * Shows the autofill options button after a fill operation completes.
 * Called by fill-coordination after fill execution.
 *
 * @param deps - Action dependencies
 * @param payload - Fill info (sourceRange, targetRange, sheetId, options)
 */
export const SHOW_AUTOFILL_OPTIONS: ActionHandler = (
  deps: ActionDependencies,
  payload?: {
    sourceRange: CellRange;
    targetRange: CellRange;
    sheetId: SheetId;
    options: FillOptions;
  },
): ActionResult => {
  if (!payload) {
    return { handled: false, reason: 'disabled', error: 'No fill info provided' };
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().showAutofillOptionsButton({
    sourceRange: payload.sourceRange,
    targetRange: payload.targetRange,
    sheetId: payload.sheetId,
    originalOptions: payload.options,
  });

  return handled();
};

/**
 * HIDE_AUTOFILL_OPTIONS
 *
 * Hides the autofill options button.
 * Called when user clicks away, presses Escape, or starts another operation.
 *
 * @param deps - Action dependencies
 */
export const HIDE_AUTOFILL_OPTIONS: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().hideAutofillOptionsButton();
  return handled();
};

/**
 * APPLY_AUTOFILL_OPTION
 *
 * Re-executes the fill operation with a different fill type.
 * Uses the stored fill info from the autofill options button.
 *
 * @param deps - Action dependencies
 * @param payload - Selected option type
 */
export const APPLY_AUTOFILL_OPTION: AsyncActionHandler = async (
  deps: ActionDependencies,
  payload?: { option: AutoFillOptionType },
): Promise<ActionResult> => {
  if (!payload?.option) {
    return { handled: false, reason: 'disabled', error: 'No option provided' };
  }

  const uiStore = getUIStore(deps);

  // Get the stored fill info
  const { lastFillInfo } = uiStore.getState().autofillOptions;
  if (!lastFillInfo) {
    uiStore.getState().hideAutofillOptionsButton();
    return { handled: false, reason: 'disabled', error: 'No fill info available' };
  }

  const { sourceRange, targetRange, sheetId, originalOptions } = lastFillInfo;

  // Build new fill options based on selected option type
  const newOptions = buildFillOptionsFromOption(originalOptions, payload.option);

  // Execute the fill operation via Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  const result = await executeFillViaWorksheet(ws, sourceRange, targetRange, sheetId, newOptions);

  // Hide the autofill options button
  uiStore.getState().hideAutofillOptionsButton();

  if (!result.success) {
    return {
      handled: true,
      error: result.updates.errors.map((e) => e.error).join(', '),
    };
  }

  return handled();
};
