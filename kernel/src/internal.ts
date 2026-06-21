/**
 * Internal-only exports for monorepo consumers.
 *
 * Not published in the public @mog-sdk/kernel barrel.
 * Import via '@mog-sdk/kernel/internal' inside the monorepo.
 */

// Context — Tier 4 internal (contains ComputeBridge + viewport)
export { type DocumentContext } from './context';

// Document — exposes .context with ISpreadsheetKernelContext
export { type DocumentHandleInternal } from './api/document';

// Host-backed document creation — workspace-private, NOT public SDK surface.
export { _createDocumentHandleInternal } from './api/document';
export {
  INTERNAL_INTERACTIVE_DEFERRED_IMPORT,
  createInteractiveDeferredDocumentFromXlsx,
} from './api/document/document-factory';

// Lifecycle system — needed by host-backed document creation in @mog/kernel-host-internal.
export {
  DocumentLifecycleSystem,
  type DocumentLifecycleConfig,
  type DocumentLifecycleConfigHost,
} from './document';

// Bridges — Rust bridge internals
export {
  ComputeBridge,
  createComputeBridge,
  createComputeBridgeFromTransport,
  ComputeCore,
  BRIDGE_METHOD_KIND,
  type BridgeMethodKind,
  type InitPhase,
} from './bridges/compute';

// =============================================================================
// Context — kernel infrastructure internals
// =============================================================================

export {
  createDocumentContext,
  createEventBus,
  createKernelContext,
  installEvictionSink,
  type IDomainContext,
  type IKernelContext,
} from './context';

// =============================================================================
// Defaults — Core, Equation, Sheet-meta, Diagram, TextEffect, Ink
// =============================================================================

export {
  DEFAULT_CALCULATION_SETTINGS,
  DEFAULT_WORKBOOK_SETTINGS,
  DEFAULT_SHEET_SETTINGS,
  DEFAULT_SHEET_PRINT_SETTINGS,
} from './domain/workbook/core-defaults';

export {
  getEquationStyleDefaults,
  getEquationStyleDefault,
  getRequiredEquationFields,
  isEquationFieldRequired,
  EQUATION_STYLE_SCHEMA,
  EQUATION_SCHEMA,
  EQUATION_OBJECT_SCHEMA,
} from './domain/equations/equation-defaults';

export {
  SHEET_META_DEFAULT_ROW_HEIGHT,
  SHEET_META_DEFAULT_COL_WIDTH,
  SHEET_META_SCHEMA,
} from './domain/sheets/sheet-meta-defaults';

export { createGradientTextEffectConfig } from './domain/text-effects/text-effects-defaults';

export {
  DIAGRAM_DIAGRAM_SCHEMA,
  DIAGRAM_NODE_SCHEMA,
  getRequiredDiagramFields,
  getRequiredDiagramNodeFields,
  getDiagramDefault,
  getDiagramDefaults,
  getDiagramNodeDefault,
  getDiagramNodeDefaults,
  isDiagramFieldRequired,
  isDiagramNodeFieldRequired,
} from './domain/diagram/diagram-defaults';

// Ink schema defaults
export {
  DRAWING_OBJECT_SCHEMA,
  INK_STROKE_SCHEMA,
  INK_TOOL_STATE_SCHEMA,
  getSchemaDefaults,
  isSchemaFieldRequired,
} from './domain/drawing/ink/ink-schema-defaults';

// Ink tool defaults
export {
  SHAPE_RECOGNITION_THRESHOLDS,
  TOOL_DEFAULT_COLORS,
  TOOL_DEFAULT_OPACITIES,
  TOOL_DEFAULT_WIDTHS,
  TOOL_SUPPORTS_PRESSURE,
  getAllDefaultToolSettings,
  getDefaultToolSettings,
} from './domain/drawing/ink/ink-tool-defaults';

// Ink spatial index utilities
export {
  EMPTY_BOUNDING_BOX,
  boundsContains,
  boundsIntersect,
  computePointsBounds,
  computeStrokeBounds,
  expandBounds,
  getBoundsArea,
  getBoundsCenter,
  getBoundsHeight,
  getBoundsWidth,
  intersectBounds,
  isValidBounds,
  pointHitsStroke,
  pointIntersectsBounds,
  pointToSegmentDistanceSquared,
  pointToStrokeDistance,
  unionBounds,
  type InkBoundingBox,
} from './domain/drawing/ink/ink-spatial-index';

// =============================================================================
// Domain — Built-in styles, Custom lists
// =============================================================================

export {
  BUILT_IN_STYLES,
  STYLE_CATEGORY_LABELS,
  STYLE_CATEGORY_ORDER,
  getBuiltInStyleById,
  getBuiltInStyles,
  getBuiltInStylesByCategory,
  isBuiltInStyle,
} from './domain/cells/built-in-styles';

export { BUILT_IN_LISTS } from './domain/fill/custom-lists';

// =============================================================================
// Services — Filesystem utilities
// =============================================================================

export {
  getBasename,
  getDirname,
  joinPath,
  normalizePath,
  createAppFileSystem,
  createFilesystemService,
  DirectoryExistsError,
  DirectoryNotEmptyError,
  DirectoryNotFoundError,
  FileExistsError,
  FileNotFoundError,
  IsDirectoryError,
  NotDirectoryError,
  PathEscapeError,
  PermissionDeniedError,
} from './services/filesystem';

// =============================================================================
// Bridges — Compute generated types (pivot, etc.)
// =============================================================================

export type {
  AggregateFunction,
  PivotColumnHeader,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotFilter,
  PivotRow,
  PivotTableConfig,
  PivotTableLayout,
  PivotTableResult,
  PivotTableStyle,
} from './bridges/compute/compute-types.gen';

// =============================================================================
// API utilities / introspection (internal)
// =============================================================================

export { getFunctionCatalog, getFunctionInfo, getWorkbookSnapshot } from './api';

export {
  SnapshotRootCaptureError,
  WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE,
  YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING,
  YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
  captureWorkbookSnapshotRootRecord,
  captureYrsFullStateSnapshotRootPayload,
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
  decodeWorkbookSnapshotRootRecord,
  decodeYrsFullStateSnapshotRootPayload,
  validateWorkbookSnapshotRootRecord,
  validateYrsFullStateSnapshotRootPayload,
  type SnapshotRootByteSyncPort,
  type SnapshotRootCaptureErrorCode,
  type WorkbookSnapshotRootPayload,
  type WorkbookSnapshotRootRecord,
  type YrsFullStateSnapshotRootPayload,
} from './document/version-store/snapshot-root-capture';

export {
  SnapshotRootReloadService,
  createSnapshotRootReloadService,
  type SnapshotRootCurrentWorkbookMutationGuarantee,
  type SnapshotRootFreshLifecycleHydrationInput,
  type SnapshotRootFreshLifecycleHydrationResult,
  type SnapshotRootFreshLifecycleHydrator,
  type SnapshotRootFreshLifecycleMutationGuarantee,
  type SnapshotRootReloadDiagnostic,
  type SnapshotRootReloadDiagnosticCode,
  type SnapshotRootReloadError,
  type SnapshotRootReloadErrorCode,
  type SnapshotRootReloadInput,
  type SnapshotRootReloadResult,
  type SnapshotRootReloadServiceOptions,
  type SnapshotRootReloadSourceKind,
} from './document/version-store/snapshot-root-reload-service';

export {
  createDocumentLifecycleSnapshotRootHydrator,
  type DocumentLifecycleSnapshotRootHydratorOptions,
  type SnapshotRootFreshLifecycleMaterialization,
} from './api/document/snapshot-root-lifecycle-hydrator';

export {
  SnapshotRootMaterializationService,
  createSnapshotRootMaterializationService,
  type SnapshotRootMaterializationDiagnostic,
  type SnapshotRootMaterializationDiagnosticCode,
  type SnapshotRootMaterializationResult,
  type SnapshotRootMaterializationServiceOptions,
} from './document/version-store/snapshot-root-materialization-service';

export {
  VersionPersistence,
  createVersionPersistence,
  type VersionPersistenceBoundaryDiagnostic,
  type VersionPersistenceBoundaryDiagnosticCode,
  type VersionPersistenceBoundaryDiagnosticSource,
  type VersionPersistenceBoundaryKind,
  type VersionPersistenceBoundaryRequest,
  type VersionPersistenceBoundaryResult,
  type VersionPersistenceOptions,
  type VersionPersistenceReloadDiagnostic,
  type VersionPersistenceReloadDiagnosticCode,
  type VersionPersistenceReloadDiagnosticSource,
  type VersionPersistenceReloadRequest,
  type VersionPersistenceReloadResult,
  type VersionPersistenceSnapshotRootMaterializer,
} from './document/version-store/version-persistence';
