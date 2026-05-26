/**
 * State Hooks Index
 *
 * Re-exports all React hooks for the renderer architecture state machines.
 *
 * Usage:
 * ```tsx
 * import {
 * CoordinatorProvider,
 * useCoordinator,
 * useSelection,
 * useEditor,
 * useClipboard,
 * useRenderer,
 * } from '../hooks';
 * ```
 *
 * @see ARCHITECTURE.md - Controller/Hook/Component Separation
 */

// =============================================================================
// COORDINATOR
// =============================================================================

export {
  CoordinatorProvider,
  createSheetCoordinator,
  useCoordinator,
  type CoordinatorProviderProps,
  type SheetCoordinator,
  type SheetCoordinatorConfig,
} from './shared/use-coordinator';

// =============================================================================
// SELECTION
// =============================================================================

export { useSelection, type UseSelectionReturn } from './selection/use-selection';

// PREFERRED: Actions-only hook for better performance
export {
  useSelectionActions,
  type UseSelectionActionsReturn,
} from './selection/use-selection-actions';

// =============================================================================
// ACTIVE CELL (Granular Selection Subscription)
// =============================================================================

export { useActiveCell, type UseActiveCellReturn } from './selection/use-active-cell';

// =============================================================================
// GRANULAR SELECTION HOOKS (Performance-Optimized Subscriptions)
// =============================================================================

export {
  useIsSelecting,
  useSelectionRanges,
  useSelectionSummary,
  type SelectionFlags,
  type SelectionSummary,
} from './selection/use-granular-selection';

// =============================================================================
// DEBOUNCED SELECTION (Low-frequency UI components)
// =============================================================================

export {
  DEFAULT_SELECTION_SETTLE_DEBOUNCE_MS,
  useDebouncedActiveCell,
  useDebouncedSelection,
  useDebouncedSelectionRanges,
  type DebouncedSelectionState,
} from './selection/use-debounced-selection';

export {
  useHeaderResize,
  type HeaderResizeActions,
  type HeaderResizeState,
  type UseHeaderResizeReturn,
} from './structure/use-header-resize';

export {
  useTableResize,
  type TableResizeActions,
  type TableResizeState,
  type UseTableResizeReturn,
} from './structure/use-table-resize';

export {
  useFillHandle,
  type FillHandleActions,
  type FillHandleState,
  type UseFillHandleReturn,
} from './structure/use-fill-handle';

// =============================================================================
// EDITOR
// =============================================================================

// PREFERRED: Granular hooks for better performance
export { useEditorModeIndicator, type UseEditorModeIndicatorReturn } from './editing/use-editor';
export { useEditorActions, type UseEditorActionsReturn } from './editing/use-editor-actions';
export { useEditorState, type UseEditorStateReturn } from './editing/use-editor-state';

// Full hook (subscribes to all editor state - use sparingly)
export { useEditor, type UseEditorReturn } from './editing/use-editor';

// =============================================================================
// CLIPBOARD
// =============================================================================

export {
  useClipboard,
  useClipboardEvents,
  type UseClipboardEventsOptions,
  type UseClipboardEventsReturn,
  type UseClipboardReturn,
} from './editing/use-clipboard';

// =============================================================================
// RENDERER
// =============================================================================

// PREFERRED: Granular hooks for better performance
export { useRendererActions, type UseRendererActionsReturn } from './view/use-renderer-actions';
export { useRendererStatus, type UseRendererStatusReturn } from './view/use-renderer-status';

// LEGACY: Full hook (subscribes to more state than typically needed)
// Use the granular hooks above instead for new code
export { useRenderer, type UseRendererReturn } from './view/use-renderer';

// =============================================================================
// CELL PROPERTIES
// =============================================================================

export { useCellProperties, type UseCellPropertiesReturn } from './settings/use-cell-properties';

// =============================================================================
// INPUT (Scroll, Zoom, Pan, Touch Gestures)
// =============================================================================

// PREFERRED: Granular hooks for better performance
export {
  useInputEventHandlers,
  type UseInputEventHandlersReturn,
} from './editing/use-input-event-handlers';
export { useInputState, type UseInputStateReturn } from './editing/use-input-state';
export { useScrollActions, type UseScrollActionsReturn } from './navigation/use-scroll-actions';
export { useScrollState } from './navigation/use-scroll-state';

// =============================================================================
// OBJECT INTERACTION (Floating Objects)
// =============================================================================

export {
  useObjectInteraction,
  type UseObjectInteractionReturn,
} from './objects/use-object-interaction';

// =============================================================================
// FOCUS (Focus-Based Keyboard Handling)
// =============================================================================

export {
  GLOBAL_SHORTCUTS,
  isGlobalShortcut,
  useFocus,
  type FocusLayer,
  type FocusLayerType,
  type FocusSnapshot,
  type UseFocusReturn,
} from './navigation/use-focus';

// =============================================================================
// CHART UI (Selection, Editing, Creation Wizard)
// =============================================================================

export { useChartUI, type UseChartUIReturn } from './charts/use-chart';
export {
  useChartEditorActions,
  type UseChartEditorActionsOptions,
  type UseChartEditorActionsReturn,
} from './charts/use-chart-editor-actions';
export { useCharts, type UseChartsOptions, type UseChartsReturn } from './charts/use-charts';

// =============================================================================
// KEYBOARD (Centralized Keyboard Shortcut Handling)
// =============================================================================

export { useKeyboard, type UseKeyboardReturn } from './navigation/use-keyboard';

// =============================================================================
// ACTION DISPATCH
// =============================================================================

export {
  useActionDependencies,
  useDispatch,
  type UseActionDependenciesReturn,
} from './toolbar/use-action-dependencies';

// =============================================================================
// FIND & REPLACE
// =============================================================================

export { useFindReplace, type UseFindReplaceReturn } from './navigation/use-find-replace';

// =============================================================================
// PRINT SETTINGS (15-PRINT-EXPORT)
// =============================================================================

export { usePrintSettings, type UsePrintSettingsReturn } from './file-io/use-sheet-print-settings';

// Page Layout dispatch: read-only print-area hook for ribbon page-layout group.
export { usePrintArea, type UsePrintAreaReturn } from './file-io/use-print-area';

// =============================================================================
// GRID-SPECIFIC HOOKS (Keyboard and Mouse)
// =============================================================================

export { useGridKeyboard } from './navigation/use-grid-keyboard';
export { useGridMouse } from './shared/use-grid-mouse';

// =============================================================================
// UTILITY HOOKS
// =============================================================================

export { useDebouncedValue, useDebouncedValueWithOptions } from './shared/use-debounced-value';

// =============================================================================
// FORMULA AUTOCOMPLETE
// =============================================================================

export {
  useFormulaAutocomplete,
  type UseFormulaAutocompleteReturn,
} from './editing/use-formula-autocomplete';

// =============================================================================
// CONTEXT MENU ACTIONS
// =============================================================================

export {
  useContextMenuActions,
  type UseContextMenuActionsReturn,
} from './toolbar/use-context-menu-actions';

// =============================================================================
// COMMENT POPOVER
// =============================================================================

export {
  useCommentPopover,
  type CommentPopoverMode,
  type UseCommentPopoverReturn,
} from './comments/use-comment-popover';

// =============================================================================
// SLICERS
// =============================================================================

export {
  useSlicers,
  type SlicerDefinition,
  type UseSlicersOptions,
  type UseSlicersReturn,
} from './data/use-slicers';

// =============================================================================
// GRID MOUSE HELPERS
// =============================================================================

export {
  COMMENT_INDICATOR,
  FILTER_BUTTON,
  VALIDATION_DROPDOWN,
  getSelectedColumnsOrSingle,
  getSelectedRowsOrSingle,
  isClickOnCommentIndicator,
  isClickOnFilterButton,
  isClickOnValidationDropdown,
  type SelectionRange,
} from './grid-mouse/helpers/click-detection';

// =============================================================================
// UI STORE CONVENIENCE HOOKS
// =============================================================================

export {
  useCFDialog,
  useDVDialog,
  useIsCFDialogOpen,
  useIsDVDialogOpen,
  useIsRulesManagerOpen,
  useQuickRuleDialog,
} from './shared/ui-store-hooks';

// =============================================================================
// ACCESSIBILITY (Accessibility Checker Hook)
// =============================================================================

export {
  useAccessibilityChecker,
  type UseAccessibilityCheckerReturn,
} from './settings/use-accessibility-checker';

// =============================================================================
// VIEW ADAPTER HOOKS
// =============================================================================

export { useToolbarContext } from './toolbar/use-toolbar-context';
export { useViewAdapter } from './view/use-view-adapter';

// =============================================================================
// PIVOT TABLES
// =============================================================================

export {
  usePivotContextMenuActions,
  type ShowValuesAsType,
  type UsePivotContextMenuActionsOptions,
  type UsePivotContextMenuActionsReturn,
} from './data/use-pivot-context-menu-actions';
export {
  usePivotEditorActions,
  type UsePivotEditorActionsOptions,
  type UsePivotEditorActionsReturn,
} from './data/use-pivot-editor-actions';
export {
  usePivotTables,
  type PivotOutputLocation,
  type UsePivotTablesOptions,
  type UsePivotTablesReturn,
} from './data/use-pivot-tables';

// =============================================================================
// SHEET TAB ACTIONS
// =============================================================================

export {
  useSheetTabActions,
  type SheetInfo,
  type UseSheetTabActionsOptions,
  type UseSheetTabActionsReturn,
} from './structure/use-sheet-tab-actions';

// =============================================================================
// SHELL COORDINATOR ALIASES (backward compatibility)
// =============================================================================

// Aliases for backwards compatibility - prefer useCoordinator/CoordinatorProvider
export {
  CoordinatorProvider as ShellCoordinatorProvider,
  useCoordinator as useShellCoordinator,
} from './shared/use-coordinator';

// =============================================================================
// TOOLBAR & APP-LEVEL HOOKS
// =============================================================================

export { useComments, useHasComment, type UseCommentsReturn } from './comments/use-comments';
export {
  DEFAULT_HIGHLIGHT_STYLES,
  useConditionalFormatting,
  type UseConditionalFormattingOptions,
  type UseConditionalFormattingReturn,
} from './data/use-conditional-formatting';
export { useFilterActions, type UseFilterActionsReturn } from './data/use-filter-actions';
export { useGroupingActions, type UseGroupingActionsReturn } from './data/use-grouping-actions';
// useAutoSum: DELETED. Use the AUTO_SUM action
// handler (smart range detection) or INSERT_AUTO_FUNCTION (viewport scan).
export { useCalculationMode, type UseCalculationModeReturn } from './editing/use-calculation-mode';
export {
  useActiveDrawingId,
  useInkActive,
  useInkColor,
  useInkTool,
  useInkWidth,
} from './objects/use-ink';
export {
  useSelectedTextEffect,
  useSelectedTextEffectDebounced,
  type TextEffectTextBox,
} from './objects/useSelectedTextEffects';
export { useSheetSelection } from './selection/use-sheet-selection';
export { useTableSelection, type UseTableSelectionReturn } from './selection/use-table-selection';
export {
  useWorkbookSettings,
  type UseWorkbookSettingsReturn,
} from './settings/use-workbook-settings';
// useMerge deleted in Text formatting dispatch — see
// hooks/structure/index.ts for the migration note.
export {
  useAllSheetsProtection,
  useSheetProtection,
  type UseAllSheetsProtectionReturn,
  type UseSheetProtectionReturn,
} from './structure/use-sheet-protection';
export {
  useCommandRegistration,
  type CommandRegistrationActions,
} from './toolbar/use-command-registration';
export {
  useFormulaBarContextMenuActions,
  type UseFormulaBarContextMenuActionsReturn,
} from './toolbar/use-formula-bar-context-menu-actions';
export {
  useToolbarActions,
  type UseToolbarActionsOptions,
  type UseToolbarActionsReturn,
} from './toolbar/use-toolbar-actions';
export {
  useFrozenPanes,
  type FrozenPanes,
  type UseFrozenPanesReturn,
} from './view/use-frozen-panes';
export { usePageBreaks, type PageBreaks, type UsePageBreaksReturn } from './view/use-page-breaks';
export { usePastePreview, type UsePastePreviewReturn } from './view/use-paste-preview';
export { useScrollSyncTransform } from './view/use-scroll-sync-transform';
export { useSheetViewOptions, type UseSheetViewOptionsReturn } from './view/use-sheet-view-options';
export { useTraceArrows, type UseTraceArrowsReturn } from './view/use-trace-arrows';

// =============================================================================
// SPARKLINE MANAGER
// =============================================================================

export { useSparklineManager } from './data/use-sparkline-manager';

// =============================================================================
// INTERACTIVE ELEMENT POSITIONS (Canvas Interactive Element Layer)
// =============================================================================

export { useInteractiveElementPositions } from './view/use-interactive-element-positions';
