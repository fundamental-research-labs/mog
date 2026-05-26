/**
 * Unified Action System - Engine Implementation
 *
 * This module provides the action dispatch system implementation.
 * Types are defined in contracts/src/actions/; implementation is here.
 *
 * Usage:
 * ```typescript
 * import { dispatch, isActionImplemented } from '../actions';
 *
 * // Dispatch an action
 * const result = dispatch('TOGGLE_BOLD', deps);
 *
 * // Check if action is implemented
 * if (isActionImplemented('OPEN_PASTE_SPECIAL_DIALOG')) {
 * // Show paste special option
 * }
 * ```
 *
 */

// =============================================================================
// Dispatcher
// =============================================================================

export {
  dispatch,
  getImplementationStats,
  getImplementedActions,
  getUnimplementedActions,
  isActionImplemented,
} from './dispatcher';

// =============================================================================
// Re-export Types from Contracts
// =============================================================================

import type * as ActionContracts from '@mog-sdk/contracts/actions';

export type ActionDependencies = ActionContracts.ActionDependencies;
export type ActionHandler = ActionContracts.ActionHandler;
export type ActionHandlerMap = ActionContracts.ActionHandlerMap;
export type ActionResult = ActionContracts.ActionResult;
export type ActionType = ActionContracts.ActionType;
export type KeyboardActionPayload = ActionContracts.KeyboardActionPayload;
export type ClipboardActionType = ActionContracts.ClipboardActionType;
export type EditorActionType = ActionContracts.EditorActionType;
export type FormattingActionType = ActionContracts.FormattingActionType;
export type ObjectActionType = ActionContracts.ObjectActionType;
export type RibbonDropdownId = ActionContracts.RibbonDropdownId;
export type RibbonTabId = ActionContracts.RibbonTabId;
export type SelectionActionType = ActionContracts.SelectionActionType;
export type StructureActionType = ActionContracts.StructureActionType;
export type UIActionType = ActionContracts.UIActionType;
export type WorkbookActionType = ActionContracts.WorkbookActionType;

// Re-export type guards from spreadsheet-utils (runtime code)
export {
  isClipboardAction,
  isEditorAction,
  isFormattingAction,
  isObjectAction,
  isSelectionAction,
  isStructureAction,
  isUIAction,
  isValidActionType,
  isWorkbookAction,
} from './type-guards';
