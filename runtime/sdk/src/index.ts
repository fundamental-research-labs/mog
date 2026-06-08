/**
 * @mog-sdk/sdk - Shortcut Data OS SDK
 *
 * Headless spreadsheet engine for Node.js. Runs the full spreadsheet engine
 * (Rust compute-core + kernel bridges) without a browser. Uses the same
 * lifecycle state machine as the browser app for shared error handling,
 * cleanup, and dispose orchestration.
 *
 * Runtime internals:
 * - Native Rust compute engine loaded through optional platform packages
 * - Bundled kernel bridge/lifecycle code
 *
 * @example
 * ```typescript
 * import { createWorkbook } from '@mog-sdk/sdk';
 *
 * const wb = await createWorkbook();
 * const ws = wb.activeSheet;
 * await ws.setCell('A1', 100);
 * await ws.setCell('A2', '=A1*2');
 * const val = await ws.getValue('A2'); // 200
 *
 * await wb.dispose();
 * ```
 *
 * @see runtime/sdk/src/boot.ts - HeadlessEngine implementation
 * @see kernel/src/api/ - createWorkbook factory
 * @see kernel/src/lifecycle/ - Shared lifecycle state machine
 */

// ---------------------------------------------------------------------------
// Primary API — kernel createWorkbook factory
// ---------------------------------------------------------------------------
export {
  createWorkbook,
  createHeadlessEngine,
  createHeadlessEngineFromYrsState,
  HeadlessEngine,
  type ChartImageFrame,
  type ChartRasterBackend,
  type ChartRasterRequest,
  type ChartRasterResult,
  type ChartRenderingConfig,
  type ChartRenderingOptions,
  type CreateWorkbookOptions,
  type HeadlessCodeExecutorFactory,
  type HeadlessOptions,
  type MogSdkLogger,
  type NapiAddonModule,
} from './boot';

export {
  CollaborativeEngine,
  createCollaborativeGroup,
  type CollaborativeEngineOptions,
  type SyncMode,
} from './collaborative-engine';

// ---------------------------------------------------------------------------
// Kernel-backed public APIs — SDK-owned declarations, bundled runtime
// ---------------------------------------------------------------------------
export { Utils } from './public-kernel-facade';
export type { CellWriteData } from '@mog-sdk/contracts/store';
export type { FilterExpression, RecordValues, TableRecord } from '@mog-sdk/contracts/api';
export type { CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
export type { FormulaA1 } from '@mog-sdk/contracts/cells';
export type { StoreCellData } from '@mog-sdk/contracts/store';

// ---------------------------------------------------------------------------
// Kernel utility functions — flat re-exports for convenience
// ---------------------------------------------------------------------------
export {
  colToLetter,
  parseCellAddress,
  parseCellRange,
  rangeToA1,
  toA1,
} from './public-kernel-facade';

// ---------------------------------------------------------------------------
// Contract types — Workbook, Worksheet, and friends
// ---------------------------------------------------------------------------
export type {
  Workbook,
  Worksheet,
  ScreenshotOptions,
  WorkbookSecurity,
} from '@mog-sdk/contracts/api';
export type {
  DocumentImportOptions as ImportOptions,
  DocumentSource,
} from '@mog-sdk/contracts/document';

// ---------------------------------------------------------------------------
// Public SDK contract types — MogDocument, factory, errors, events, providers
// ---------------------------------------------------------------------------
export {
  MogDocumentFactory,
  MogSdkError,
  MogSdkEventFacade,
  type MogSdkError as MogSdkErrorInstance,
  type MogSdkErrorOptions,
  type MogSdkEventFacade as MogSdkEventFacadeInstance,
} from './public-kernel-facade';
export type {
  MogDocument,
  IMogDocumentFactory,
  MogDocumentCreateOptions,
  MogDocumentImportOptions,
  MogDocumentOpenResult,
  MogCreateWorkbookOptions,
  MogDocumentWorkbookOptions,
  MogCollaborationHandle,
} from '@mog-sdk/contracts/sdk';
export type {
  MogSdkErrorCode,
  IMogSdkError,
  MogSdkErrorJSON,
  MogSdkDiagnostics,
} from '@mog-sdk/contracts/sdk';
export type {
  MogSdkEvent,
  MogSdkEventType,
  MogSdkEventOrigin,
  MogSdkEventScope,
  TypedMogSdkEvent,
  IMogSdkEventFacade,
  MogSdkSubscription,
} from '@mog-sdk/contracts/sdk';
export type {
  MogDocumentStatus,
  MogDocumentCloseResult,
  MogDocumentPersistenceState,
  MogDocumentDurabilityMode,
  IMogDocumentHistory,
  MogUndoState,
  MogDisposable,
  MogAsyncDisposable,
} from '@mog-sdk/contracts/sdk';
export type {
  MogDocumentSource,
  MogFileFormat,
  MogImportOptions,
  MogImportResult,
  MogImportWarning,
  MogExportOptions,
  MogExportResult,
  MogSaveMode,
  MogCloseBehavior,
} from '@mog-sdk/contracts/sdk';
export type {
  MogSdkRuntimeProvider,
  MogSdkStorageProvider,
  MogSdkWorkbookStateProvider,
  MogSdkSecurityProvider,
  MogSdkCollaborationProvider,
  MogSdkProviderOwnership,
} from '@mog-sdk/contracts/sdk';

// ---------------------------------------------------------------------------
// Security types — Data access control (Layer 2). Enforcement lives in Rust;
// these types cover the SDK surface for `wb.security.*` and the session-level
// principal config passed into createWorkbook.
// ---------------------------------------------------------------------------
export type {
  DocumentSecurityConfig,
  AccessPrincipal,
  AccessTarget,
  AccessLevel,
  AccessPolicy,
  AccessPolicyMetadata,
  AccessExplanation,
  PolicyId,
  TagMatcher,
} from '@mog-sdk/contracts/security';

// ---------------------------------------------------------------------------
// API introspection — programmatic SDK API discovery for AI agents
// ---------------------------------------------------------------------------
export { api, apiSpec } from './api-describe';
export {
  analyzeMogCode,
  apiGuidance,
  apiGuidanceCatalog,
  apiGuidanceCatalogValidation,
  apiGuidanceTargets,
  apiCompatibility,
  explainApiSymbol,
  preflightMogCode,
  resolveGuidanceTarget,
  validateApiGuidanceCatalog,
} from './agent-guidance/index';
export type {
  ApiSpec,
  ApiSpecFunctionEntry,
  ApiSpecInterfaceEntry,
  ApiSpecTypeEntry,
  OverviewResult,
  InterfaceResult,
  MethodSummary,
  MethodResult,
  TypeResult,
  DescribeResult,
  MethodNode,
  SubApiNode,
  RootNode,
  TypesNode,
} from './api-describe';
export type {
  ApiGuidanceApi,
  ApiGuidanceCatalogValidation,
  ApiGuidanceCatalogValidationIssue,
  ApiGuidanceCategory,
  ApiGuidanceCompoundMatcher,
  ApiGuidanceDiagnostic,
  ApiGuidanceDiagnosticCode,
  ApiGuidanceDialect,
  ApiGuidanceEntry,
  ApiGuidanceExplanation,
  ApiGuidanceMatcher,
  ApiGuidanceMatcherKind,
  ApiGuidancePreflightResult,
  ApiGuidanceSourceLocation,
  ApiGuidanceSymbolMatcher,
  ApiGuidanceTarget,
  ApiGuidanceTargetKind,
  ApiCompatibilityEntry,
  ApiCompatibilityIndex,
  ApiCompatibilityReference,
  ApiCompatibilityStatus,
  ApiCompatibilitySurface,
  ForeignApiGuidanceExplanation,
  MogApiCompatibilityExplanation,
  MogApiGuidanceExplanation,
  MogReplacement,
  SourceSpan,
} from './agent-guidance/index';
