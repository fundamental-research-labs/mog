/**
 * Shell Context
 *
 * Context providers and hooks for the OS architecture:
 *
 * ## Shell Context (App-wide)
 * - ShellProvider: Root provider for shell state (view navigation, record detail)
 * - useShellStore: Access shell UI state with selector
 * - useActiveViewId: Get current view ID
 *
 * ## Document Context (Per-document)
 * - DocumentProvider: Per-document provider (Workbook, document UIStore)
 * - useWorkbook: Access document workbook
 * - useUIStore: Access document UI state
 *
 * ## Architecture
 * ```
 * App
 * └─ ShellProvider (app-wide - view navigation)
 * └─ DocumentProvider (per-document - data + document UI)
 * └─ SpreadsheetContent
 * ```
 *
 */

// =============================================================================
// Shell Context (App-wide)
// =============================================================================

export {
  ShellProvider,
  useActiveViewId,
  useIsRecordDetailOpen,
  useRecordDetailActions,
  useSetActiveViewId,
  useShellStore,
  useShellStoreApi,
} from './shell-context';

// =============================================================================
// Document Context (Per-document)
// =============================================================================

export {
  DocumentContext,
  DocumentProvider,
  useActiveSheetId,
  useDocumentContext,
  useEditingPivotId,
  useEventBus,
  useHideRibbon,
  useReadOnly,
  useIsFormatPainterActive,
  useIsInsertFunctionDialogOpen,
  useIsPivotDialogOpen,
  usePivotFieldPanelWidth,
  usePivotTransientOverlay,
  useSelectedPivotId,
  useUIStore,
  useUIStoreApi,
  useWorkbook,
  useWorksheet,
  useZoomLevels,
  type DocumentContextValue,
  type UIStoreFactory,
} from './document-context';

// =============================================================================
// Feature Gates Context
// =============================================================================

export {
  FeatureGatesProvider,
  RibbonGatesBridge,
  useFeatureGate,
  useFeatureGates,
  useFeatureMode,
} from './feature-gates-context';

// =============================================================================
// Trusted Embed Runtime Context
// =============================================================================

export {
  SpreadsheetEmbedRuntimeProvider,
  useSpreadsheetEmbedRuntimeOptional,
  useSpreadsheetEmbedSlot,
  useSpreadsheetHostCommandsOptional,
  type SpreadsheetEmbedActiveSheetSnapshot,
  type SpreadsheetEmbedAppBridge,
  type SpreadsheetEmbedRuntimeContextValue,
  type SpreadsheetEmbedSelectionSnapshot,
} from './embed-runtime-context';
