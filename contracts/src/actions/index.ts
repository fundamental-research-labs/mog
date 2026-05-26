/**
 * Unified Action System - Contracts
 *
 * Type definitions and utilities for the unified action dispatch system.
 *
 * Usage:
 * ```typescript
 * import type {
 *   ActionType,
 *   ActionDependencies,
 *   ActionResult,
 *   ActionHandler
 * } from '@mog-sdk/contracts/actions';
 *
 * // Type guards live in apps/spreadsheet/src/actions/type-guards.ts
 * import { isSelectionAction } from '../actions/type-guards';
 * ```
 *
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Dependencies and results
  ActionDependencies,
  ActionHandler,
  ActionHandlerMap,
  ActionResult,
  // Union type
  ActionType,
  // Async handler support (Wave 6: Ink Recognition)
  AnyActionHandler,
  AsyncActionHandler,
  // Action type categories
  AutoFillActionType,
  ChartActionType,
  ClipboardActionType,
  CommentActionType,
  ConditionalFormattingActionType,
  DataAnalysisDialogActionType,
  DragDropActionType,
  EditorActionType,
  // Equation actions
  EquationActionType,
  FillContextMenuActionType,
  FilterActionType,
  FlashFillActionType,
  FormattingActionType,
  HostCommandOwner,
  HostSpreadsheetCommand,
  HostSpreadsheetCommandBridge,
  HostSpreadsheetCommandRequest,
  HostSpreadsheetCommandResult,
  CellHorizontalAlign,
  // UI Store API interface (for type-safe handler access)
  IUIStoreApi,
  InkActionType,
  // T4 Unified keytip router: typed actionArg payload contract
  KeyboardActionPayload,
  NavigationActionType,
  ObjectActionType,
  OpenPageSetupDialogPayload,
  PageSetupDialogTab,
  PasteValidationActionType,
  PrintExportActionType,
  RepeatActionType,
  // T4b Unified keytip router: ribbon dropdown id + payload
  RibbonDropdownId,
  RibbonDropdownPayload,
  // T4 Unified keytip router: ribbon tab identifier
  RibbonTabId,
  SelectionActionType,
  SetHorizontalAlignPayload,
  SetVerticalAlignPayload,
  SlicerActionType,
  SplitActionType,
  DiagramActionType,
  StructureActionType,
  // T4 Unified keytip router: SWITCH_RIBBON_TAB payload
  SwitchRibbonTabPayload,
  CellVerticalAlign,
  TableActionType,
  // Payload types
  ThesaurusInsertPayload,
  TotalRowActionType,
  UIActionType,
  ViewActionType,
  WorkbookActionType,
} from './types';
