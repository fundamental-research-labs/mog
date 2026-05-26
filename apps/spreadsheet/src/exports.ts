/**
 * @mog/spreadsheet - Spreadsheet Application
 *
 * The complete spreadsheet application including:
 * - Coordinator: XState-based state coordination
 * - Actions: User action handlers
 * - Hooks: React hooks for spreadsheet state
 * - Machines: XState state machines
 * - UIStore: Zustand UI state management
 * - Context: React context providers
 * - Views: Grid view and components
 * - Components: Dialogs, toolbar, comments, etc.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Context
// ═══════════════════════════════════════════════════════════════════════════════
// Export context but exclude hooks that are also in ./hooks
export {
  // Document Context (Per-document) - excluding duplicates with ./hooks
  DocumentContext,
  DocumentProvider,
  // Shell Context (App-wide)
  ShellProvider,
  useActiveSheetId,
  useActiveViewId,
  useDocumentContext,
  useEditingPivotId,
  useIsFormatPainterActive,
  useIsInsertFunctionDialogOpen,
  useIsPivotDialogOpen,
  useIsRecordDetailOpen,
  useRecordDetailActions,
  useSelectedPivotId,
  useSetActiveViewId,
  useShellStore,
  useShellStoreApi,
  useUIStore,
  useUIStoreApi,
  useFeatureGate,
  useFeatureGates,
  useFeatureMode,
  FeatureGatesProvider,
  SpreadsheetEmbedRuntimeProvider,
  useHideRibbon,
  useReadOnly,
  useSpreadsheetEmbedRuntimeOptional,
  useSpreadsheetEmbedSlot,
  useSpreadsheetHostCommandsOptional,
  useWorkbook,
  useZoomLevels,
  type DocumentContextValue,
  type SpreadsheetEmbedActiveSheetSnapshot,
  type SpreadsheetEmbedAppBridge,
  type SpreadsheetEmbedRuntimeContextValue,
  type SpreadsheetEmbedSelectionSnapshot,
  type UIStoreFactory,
} from './infra/context';

// ═══════════════════════════════════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════════════════════════════════
export { dispatch } from './actions/dispatcher';
export type { ActionHandler, ActionResult } from './actions/types';

// ═══════════════════════════════════════════════════════════════════════════════
// Hooks
// ═══════════════════════════════════════════════════════════════════════════════
// Export all hooks - these are the canonical source for:
// - useCFDialog, useDVDialog, useIsCFDialogOpen, useIsDVDialogOpen, useIsRulesManagerOpen, useQuickRuleDialog
// - GLOBAL_SHORTCUTS, isGlobalShortcut
// - SheetCoordinatorConfig, createSheetCoordinator
// - SheetInfo
export * from './hooks';

// ═══════════════════════════════════════════════════════════════════════════════
// UIStore
// ═══════════════════════════════════════════════════════════════════════════════
export * from './ui-store';

// ═══════════════════════════════════════════════════════════════════════════════
// Machines
// ═══════════════════════════════════════════════════════════════════════════════
// Export machines - direct imports from systems/

// --- Grid Editing System ---
export { selectionMachine } from './systems/grid-editing/machines/grid-selection-machine';
export type {
  SelectionActor,
  SelectionState,
} from './systems/grid-editing/machines/grid-selection-machine';
export { getSelectionSnapshot } from './systems/grid-editing/machines/selection/derived-state';
export type { SelectionSnapshotResult } from './systems/grid-editing/machines/selection/derived-state';
export { SelectionEvents } from './systems/grid-editing/machines/selection/events';
export type {
  SelectionContext,
  SelectionEvent,
} from './systems/grid-editing/machines/selection/types';

export { EditorEvents } from './systems/grid-editing/machines/editor/events';
export type {
  EditorContext,
  EditorEntryMode,
  EditorEvent,
} from './systems/grid-editing/machines/editor/types';
export { editorMachine } from './systems/grid-editing/machines/grid-editor-machine';
export type { EditorActor, EditorState } from './systems/grid-editing/machines/grid-editor-machine';

export {
  ClipboardEvents,
  clipboardMachine,
  createClipboardData,
  getClipboardSnapshot,
} from './systems/grid-editing/machines/clipboard-machine';
export type {
  ClipboardActor,
  ClipboardContext,
  ClipboardEvent,
  ClipboardMachine,
  ClipboardState,
} from './systems/grid-editing/machines/clipboard-machine';

export {
  FindReplaceEvents,
  findReplaceMachine,
  getFindReplaceSnapshot,
} from './systems/grid-editing/machines/find-replace-machine';
export type {
  FindReplaceActor,
  FindReplaceContext,
  FindReplaceEvent,
} from './systems/grid-editing/machines/find-replace-machine';

export {
  CommentEvents,
  commentMachine,
  getCommentSnapshot,
  isInEditMode,
  isPopoverVisible,
} from './systems/grid-editing/machines/comment-machine';
export type {
  CommentActor,
  CommentContext,
  CommentEvent,
  CommentSnapshot,
  CommentTarget,
} from './systems/grid-editing/machines/comment-machine';

export {
  drawBorderMachine,
  getDrawBorderSnapshot,
  initialDrawBorderContext,
} from './systems/grid-editing/machines/draw-border-machine';
export type {
  DrawBorderActor,
  DrawBorderContext,
  DrawBorderEvent,
  DrawBorderState,
  DrawBorderStyle,
} from './systems/grid-editing/machines/draw-border-machine';

export {
  SlicerEvents,
  getSlicerSnapshot,
  slicerMachine,
} from './systems/grid-editing/machines/slicer-machine';
export type {
  SlicerActor,
  SlicerContext,
  SlicerEvent,
} from './systems/grid-editing/machines/slicer-machine';

// --- Renderer System ---
export {
  RendererEvents,
  createPendingInvalidate,
  createPendingScroll,
  createPendingSelection,
  getRendererSnapshot,
  rendererMachine,
} from './systems/renderer/machines/grid-renderer-machine';
export type {
  RendererActor,
  RendererContext,
  RendererEvent,
  RendererState,
} from './systems/renderer/machines/grid-renderer-machine';

export {
  PageBreakEvents,
  getPageBreakSnapshot,
  pageBreakMachine,
} from './systems/renderer/machines/page-break-machine';
export type {
  PageBreakActor,
  PageBreakDragContext,
  PageBreakEvent,
  PageBreakInfo,
  PageBreakOrientation,
  PageBreakState,
  PageBreakType,
} from './systems/renderer/machines/page-break-machine';

// --- Object System ---
export {
  ChartEvents,
  chartMachine,
  getChartSnapshot,
  getSelectedChartId,
} from './systems/objects/machines/chart-machine';
export type {
  ChartActor,
  ChartContext,
  ChartElementType,
  ChartEvent,
} from './systems/objects/machines/chart-machine';

export {
  ObjectInteractionEvents,
  getCursorForState,
  getObjectInteractionSnapshot,
  objectInteractionMachine,
} from './systems/objects/machines/object-interaction-machine';
export type {
  ObjectInteractionActor,
  ObjectInteractionContext,
  ObjectInteractionEvent,
  ObjectInteractionStateValue,
} from './systems/objects/machines/object-interaction-machine';

export {
  DiagramEvents,
  getDiagramSnapshot,
  initialDiagramContext,
  diagramMachine,
} from './systems/objects/machines/diagram-machine';
export type {
  DiagramActor,
  DiagramContext,
  DiagramEvent,
  DiagramSnapshot,
} from './systems/objects/machines/diagram-machine';

// --- Input System ---
export {
  InputEvents,
  getInputSnapshot,
  inputMachine,
} from './systems/input/machines/grid-input-machine';
export type { InputActor, InputState } from './systems/input/machines/grid-input-machine';
export { DEFAULT_INPUT_CONFIG } from './systems/input/machines/input-types';
export type {
  HitTestResult,
  InputContext,
  InputCoordinatorConfig,
  InputEvent,
  InputMachineState,
  ScrollChangeCallback,
  ScrollState,
  SheetInputEvent,
  ZoomChangeCallback,
  ZoomState,
} from './systems/input/machines/input-types';

export {
  PaneFocusEvents,
  getPaneFocusSnapshot,
  paneFocusMachine,
} from './systems/input/machines/pane-focus-machine';
export type {
  PaneFocusActor,
  PaneFocusContext,
  PaneFocusEvent,
  PaneType,
} from './systems/input/machines/pane-focus-machine';

// --- Ink System ---
export {
  addPointToBuffer,
  createInitialInkContext,
  getCurrentStrokeCopy,
  inkMachine,
  inkSelectors,
  resetStrokeBuffer,
} from './systems/ink/machines';
export type {
  InkActor,
  InkContext,
  InkEvent,
  InkMachine,
  InkSelectionMode,
  InkState,
} from './systems/ink/machines';

export {
  createInkAccessor,
  createInkCommands,
  type InkAccessor,
  type InkCommands,
} from './systems/ink/actor-access';

// --- Shared Types ---
export {
  cellKey,
  cellToA1,
  cellsEqual,
  clampCell,
  createFullColumnRange,
  createFullColumnRangeSpan,
  createFullRowRange,
  createFullRowRangeSpan,
  getRangeDimensions,
  getRangeEndCell,
  getRangeStartCell,
  isCellInRange,
  isCellInRanges,
  isFullColumnSelection,
  isFullRowSelection,
  moveCell,
  moveCellSkipHidden,
  normalizeRange,
  parseCellKey,
  rangeFromAnchorAndCell,
  rangeToA1,
  rangesEqual,
  singleCellRange,
} from './systems/shared/types';
export type {
  CellCoord,
  ClipboardCellData,
  ClipboardData,
  ClipboardSnapshot,
  Direction,
  Metric,
  PasteSpecialOptions,
  PendingAction,
  Point,
  Rect,
  RelativeComment,
  RelativeConditionalFormat,
  RelativeMerge,
  RelativeValidation,
  RemoteCursor,
  Selection,
} from './systems/shared/types';

export { colToLetter } from '@mog/spreadsheet-utils/a1';

// --- Focus utilities ---
export { getFocusSnapshot } from './systems/shared/utils/focus-utils';

// --- Structure change utilities ---
export { StructureChanges, type StructureChange } from './systems/shared/utils';

// ═══════════════════════════════════════════════════════════════════════════════
// Coordinator
// ═══════════════════════════════════════════════════════════════════════════════
// Export coordinator but exclude duplicates with ./hooks and ./machines
export {
  // Utilities
  CHART_POSITION_PRESET,
  // Keyboard coordinator
  KeyboardCoordinator,
  PIVOT_POSITION_PRESET,
  // Main class & factory (excluding createSheetCoordinator - from ./hooks)
  SheetCoordinator,
  // Actor access layer
  createActorAccessLayer,
  createKeyboardCoordinator,
  getSmartPosition,
} from './coordinator';

// Coordinator types - excluding duplicates with ./machines
export type {
  // Actor access layer types
  ActorBundle,
  ActorRefs,
  // Utility types
  AnchorPosition,
  ChartState,
  FocusState,
  // Keyboard coordinator types
  KeyboardCoordinatorDependencies,
  KeyboardHandleResult,
  ObjectInteractionState_,
  PositionOffset,
  // Cross-coordination types
  RenderInvalidation,
  RendererFactory,
  SheetStateProvider,
  SmartPositionConfig,
  SourceRange,
} from './coordinator';

// RendererDependencies from coordinator (not from views/grid)
export type { RendererDependencies } from './coordinator';

// SheetCoordinatorConfig from hooks (canonical source)
// Already exported via `export * from './hooks'`

// ═══════════════════════════════════════════════════════════════════════════════
// Views
// ═══════════════════════════════════════════════════════════════════════════════
// Export views but exclude duplicates with ./clipboard
export {
  HybridViewContainer,
  HybridViewContainerById,
  // Registry
  VIEW_REGISTRY,
  // Container components
  ViewContainer,
  ViewContainerById,
  ViewRegistry,
  ViewTabs,
  // View discovery
  getAllViews,
  // Core types and utilities
  getDefaultToolbarContext,
  getView,
  getViewsForTable,
  hasView,
} from './views';

// View types - excluding SelectOption (from ./clipboard)
export type {
  CalendarViewConfig,
  EditTarget,
  FormFieldConfig,
  FormViewConfig,
  GalleryViewConfig,
  GridViewConfig,
  HybridViewContainerProps,
  KanbanViewConfig,
  ReactViewComponent,
  ReactViewProps,
  TableId,
  TimelineViewConfig,
  ToolbarContext,
  Unsubscribe,
  ViewAdapter,
  ViewAdapterConfig,
  ViewClipboardData,
  ViewConfig,
  ViewConfigBase,
  ViewContainerByIdProps,
  ViewContainerProps,
  ViewDefinition,
  ViewId,
  ViewRenderingMode,
  ViewSelection,
  ViewTabsProps,
  ViewType,
} from './views';

// Re-export view modules (calendar, form, gallery, grid, kanban, timeline)
// These have their own namespaced exports
export * from './views/calendar';

// Form view - exclude SelectOption (already exported from ./clipboard)
// and exclude FormFieldConfig, FormViewConfig (already exported from ./views above)
export {
  CheckboxField,
  DEFAULT_FORM_CONFIG,
  DateField,
  FormField,
  FormView,
  FormViewAdapter,
  FormViewContainer,
  NumberField,
  PersonField,
  SelectField,
  SubmitButton,
  TextField,
  createFormConfig,
  formViewDefinition,
  useFormState,
} from './views/form';
// FormLayout component - imported from components subpath to avoid conflict with FormLayout type
export type {
  CheckboxFieldProps,
  DateFieldProps,
  FieldValidationError,
  FormFieldProps,
  // Exclude FormFieldConfig, FormViewConfig - already exported from ./views above
  // Note: FormLayout type is also exported from ./views via FormViewConfig
  FormFieldState,
  FormLayoutProps,
  FormSelection,
  FormState,
  FormViewContainerProps,
  FormViewProps,
  NumberFieldProps,
  PersonFieldProps,
  PersonOption,
  SelectFieldProps,
  SubmitButtonProps,
  TextFieldProps,
  UseFormStateOptions,
} from './views/form';
export { FormLayout } from './views/form/components/FormLayout';
// Note: SelectOption type from form is intentionally not exported - use ./clipboard's SelectOption instead

export * from './views/gallery';
// Grid view - exclude RendererDependencies, SheetCoordinatorConfig (from ./coordinator, ./hooks)
export {
  GridCanvas,
  GridCoordinator,
  GridView,
  GridViewAdapter,
  gridViewDefinition,
} from './views/grid';
export type { GridCanvasProps, GridViewProps } from './views/grid';
export * from './views/kanban';
export * from './views/timeline';

// ═══════════════════════════════════════════════════════════════════════════════
// Clipboard
// ═══════════════════════════════════════════════════════════════════════════════
// Export all from clipboard - SelectOption is the canonical source here
export * from './domain/clipboard';

// ═══════════════════════════════════════════════════════════════════════════════
// Utils
// ═══════════════════════════════════════════════════════════════════════════════
export * from './infra/utils';

// ═══════════════════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════════════════
export * from './infra/styles';

// ═══════════════════════════════════════════════════════════════════════════════
// Editor
// ═══════════════════════════════════════════════════════════════════════════════
// Export editor but exclude SheetInfo (from ./hooks)
export {
  RichTextSelectionManager,
  analyzeFormulaContext,
  calculateFlipPosition,
  clampToViewport,
  detectTableRefContext,
  formatNameForInsertion,
  getArgumentHintPosition,
  getAutoCompletePosition,
  getNameSuggestionIcon,
  getNameSuggestions,
  isInsideString,
  richTextSelectionManager,
} from './domain/editor';

export type {
  CharacterOffsets,
  CellGeometryLike,
  CursorScreenPosition,
  DefinedNameDefinition,
  FormulaContext,
  FunctionStackEntry,
  NameCompletionStoreLike,
  NameSuggestion,
  NameSuggestionType,
  PopupSize,
  TableInfo,
  TableRefContext,
} from './domain/editor';
// Note: SheetInfo type is exported from ./hooks (canonical source)

// ═══════════════════════════════════════════════════════════════════════════════
// Fill
// ═══════════════════════════════════════════════════════════════════════════════
// Export all from fill - CellRange is the canonical source here
export * from './domain/fill';

// ═══════════════════════════════════════════════════════════════════════════════
// Commands
// ═══════════════════════════════════════════════════════════════════════════════
export * from './actions/commands';

// ═══════════════════════════════════════════════════════════════════════════════
// UI Components
// ═══════════════════════════════════════════════════════════════════════════════
export { CollapsibleRangeInput } from './components/ui/CollapsibleRangeInput';
export {
  MinimizableDialog,
  type MinimizableDialogProps,
} from './components/ui/radix/MinimizableDialog';
