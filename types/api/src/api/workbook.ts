/**
 * Unified Spreadsheet API -- Workbook Interface
 * THE definitive API for all workbook-level operations.
 * Every consumer -- headless agents, LLM code, OS apps, browser app -- uses this.
 * No exceptions, no bypasses.
 *
 * ## Sub-API namespaces
 *
 * Domain-specific operations are grouped into readonly sub-API accessors:
 *
 *   await wb.sheets.addSheet("Sales");
 *   await wb.names.addNamedRange("total", "Sheet1!A1:A10");
 *   await wb.history.undo();
 */
import type { CallableDisposable } from '@mog/types-core/disposable';
import type { DocumentImportWarning } from '@mog-sdk/types-document/document/document';
import type { IChartBridge } from '@mog/types-bridges/chart-bridge';
import type { IInkRecognitionBridge } from '@mog/types-bridges/ink-recognition-bridge';
import type { IPivotBridge } from '@mog/types-bridges/pivot-bridge';
import type {
  EventByType,
  SpreadsheetEventType as InternalEventType,
  SpreadsheetEvent,
} from '@mog/types-events';
import type { CustomList } from '@mog/types-editor/fill/custom-lists';
import type { SelectionCheckpoint } from '@mog/types-editor/selection/types';
import type { IKernelServices } from '../services/index';
import type { MirrorReadView } from './state-mirror';
import type {
  CheckpointInfo,
  CodeResult,
  InsertWorksheetOptions,
  ExecuteOptions,
  FunctionInfo,
  IRecordsAPI,
  SheetId,
  SheetRangeDescribeResult,
  SheetRangeRequest,
  WorkbookEvent,
  WorkbookEventMap,
  ScreenshotOptions,
  SearchOptions,
  SearchResult,
  WorkbookSettings,
  WorkbookSettingsPatch,
  WorkbookSnapshot,
  WorkbookId,
  WorkbookSessionId,
  DocumentId,
  LinkId,
  ActorId,
} from './types';
import type { LinkStatus, LinkStatusReason, LinkStatusView } from './receipt-payloads';
import type { CultureInfo } from '@mog/types-culture/types';
import type { WorkbookXlsxExportOptions } from './workbook/xlsx-export';
import type {
  WorkbookHistory,
  WorkbookVersion,
  WorkbookNames,
  WorkbookNotifications,
  WorkbookProperties,
  WorkbookProtection,
  WorkbookScenarios,
  WorkbookSheets,
  WorkbookSlicerStyles,
  WorkbookSlicers,
  WorkbookTimelineStyles,
  WorkbookTableStyles,
  WorkbookCellStyles,
  WorkbookTheme,
  WorkbookChanges,
  WorkbookDiagnostics,
  WorkbookViewport,
  WorkbookPivotTableStyles,
  WorkbookFunctions,
  WorkbookSecurity,
} from './workbook/index';
import type { AccessPrincipal } from '@mog-sdk/types-document/security';
import type { Worksheet, WorksheetWithInternals } from './worksheet';
import type { IFloatingObjectManager } from '../kernel/floating-object-manager';
import type { CodeExecutionResult, CodeExecutionOptions } from '@mog/types-commands/execution';

export type { CustomList } from '@mog/types-editor/fill/custom-lists';
export type { WorkbookId, WorkbookSessionId, DocumentId, LinkId, ActorId } from './types';
export type { LinkStatus, LinkStatusReason, LinkStatusView } from './receipt-payloads';
// prettier-ignore
export type {
  CheckoutVersionResult,
  GetVersionHeadInput,
  JsonValue, ObjectDigest, PageCursor, Paged,
  ListVersionCommitsInput, ListVersionRefsInput,
  RedactionPolicy, RedactionSummary, RedactedVersionAuthor,
  VerificationSummary, VersionAnnotationText, VersionAuthor, VersionBranchName,
  VersionBranchRefReadResult, VersionBranchSelector,
  VersionCheckoutDependencyRole, VersionCheckoutDependencySummary,
  VersionCheckoutMutationGuarantee, VersionCheckoutOptions, VersionCheckoutPlan,
  VersionCheckoutResolvedTarget, VersionCheckoutResult, VersionCheckoutTarget,
  VersionCommitish, VersionCommitExpectedHead, VersionCommitMode, VersionCommitOptions,
  VersionCommitPage, VersionCreateBranchOptions, VersionCounterRecordRevision, VersionDegradedHeadResult, VersionDeleteRefOptions,
  VersionDiffDisplay, VersionDiffDisplayValue, VersionDiffCursor, VersionDiffEntry, VersionDiffInput, VersionDiffOptions, VersionDiffResourceLimit, VersionDiffResourceLimitKind, VersionDiffResourceLimitSummary, VersionDiffResourceLimitUnit, VersionDiffStructuralMetadata, VersionDiffValue, VersionDiagnosticCode,
  VersionDiagnosticMessageId, VersionDiagnosticPublicPayload,
  VersionFastForwardBranchOptions, VersionGetMergeConflictDetailRequest,
  VersionGetHeadOptions, VersionHead, VersionListCommitsOptions, VersionListRefsOptions,
  VersionLiveCollaborationState, VersionMainRefName,
  VersionApplyMergeInput, VersionApplyMergeMutationGuarantee, VersionApplyMergeOptions,
  VersionApplyMergeResolution, VersionApplyMergeResult,
  VersionApplyMergeAttemptMetadata, VersionMergeAttemptKind, VersionMergeAttemptMetadata,
  VersionMergeAttemptPersistence, VersionMergeChange, VersionMergeConflict,
  VersionMergeConflictDetailBase, VersionMergeConflictDetailPurpose,
  VersionMergeConflictDetailResolutionOption, VersionMergeConflictDetailResult,
  VersionMergeConflictValuePageRef, VersionMergeConflictValueRole,
  VersionMergeConflictResolutionOption, VersionMergeConflictResolutionOptionKind, VersionMergeInput,
  VersionMergeEndpointDeniedStatus, VersionMergeResolutionPayloadPurpose,
  VersionMergeMutationGuarantee, VersionMergeOptions, VersionMergeResult, VersionMergeResultId,
  VersionCapability, VersionCapabilityDependency, VersionCapabilityError, VersionCapabilityState,
  VersionPage, VersionPageOrder, VersionPageToken,
  VersionPendingRemoteSegmentId, VersionPromotePendingRemoteDiagnostic, VersionPromotePendingRemoteDiagnosticCode,
  VersionPromotePendingRemoteOptions, VersionPromotePendingRemoteResult, VersionPromotePendingRemoteSkippedSegment, VersionPromotePendingRemoteSkipReason, VersionPromotePendingRemoteStatus,
  VersionRecordRevision, VersionRedactedValue, VersionRedactionClass,
  VersionRef, VersionRefListResult, VersionRefMutationResult, VersionRefName,
  VersionRefReadResult, VersionRefSelector, VersionDiagnostic, VersionDiagnosticSeverity, VersionError,
  VersionPutMergeResolutionPayloadRequest, VersionPutMergeResolutionPayloadResult,
  VersionSaveMergeResolutionsRequest, VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
  VersionSemanticDiffPage, VersionSemanticValue, VersionSealedResolutionPayloadRef,
  VersionSealedResolutionPayloadStorageMode,
  VersionResult, VersionSurfaceDiagnosticCode, VersionSurfaceDiagnosticSeverity,
  VersionSurfaceLiveCollaborationStatus, VersionSurfaceStage, VersionSurfaceStatus, VersionSurfaceStorageBackend,
  VersionSymbolicRef, VersionSymbolicRefReadResult, VersionUpdateBranchOptions,
  WorkbookCommitAnnotationSummary, WorkbookCommitId, WorkbookCommitRef, WorkbookCommitSummary,
  WorkbookDiffPage, WorkbookVersion,
  WorkbookVersionCapabilityStage, WorkbookVersionCapabilityStatus, WorkbookVersionDependency,
  WorkbookVersionDiagnostic, WorkbookVersionDiagnosticCode, WorkbookVersionDiagnosticSeverity,
  WorkbookVersionHead, WorkbookVersionHeadStatus, WorkbookVersionRolloutStage, WorkbookVersionStatus,
} from './workbook/version';
export type * from './workbook/version-proposal';
export type {
  VersionRevertCasAdmission,
  VersionRevertDomainAdmission,
  VersionRevertHistoryGapAdmission,
  VersionRevertInput,
  VersionRevertMutationGuarantee,
  VersionRevertOptions,
  VersionRevertPreflightAdmission,
  VersionRevertResult,
  VersionRevertReviewInvalidationAdmission,
  VersionRevertStaleHeadAdmission,
  VersionRevertTarget,
} from './workbook/version-revert';
export type * from './workbook/version-revert';
export type * from './workbook/version-review';
export type * from './workbook/xlsx-export';

/** Options for wb.calculate() — all optional, backward compatible. */
export interface CalculateOptions {
  /**
   * Enable iterative calculation for circular references.
   * - `true` — enable with default settings (100 iterations, 0.001 threshold)
   * - `{ maxIterations?: number; maxChange?: number }` — enable with custom settings
   * - `false` — disable (override workbook setting)
   * - `undefined` — use workbook setting (default)
   */
  iterative?: boolean | { maxIterations?: number; maxChange?: number };
}

/** Result from wb.calculate() — includes convergence metadata. */
export interface CalculateResult {
  /** Whether circular references were detected. */
  hasCircularRefs: boolean;
  /** Whether iterative calculation converged. Only meaningful when hasCircularRefs is true. */
  converged: boolean;
  /** Number of iterations performed (0 if no circular refs). */
  iterations: number;
  /** Maximum per-cell delta at final iteration. */
  maxDelta: number;
  /** Number of cells involved in circular references. */
  circularCellCount: number;
  /** Number of formula cells recomputed during this calculation. Zero when nothing changed since last full recalc. */
  recomputedCount: number;
}

export interface WorkbookCustomListInput {
  /** Display name for the user-defined list. */
  name: string;
  /** Ordered values used by fill and custom sort operations. */
  values: readonly string[];
}

export interface WorkbookCustomListUpdate {
  /** Updated display name. Omit to keep the current name. */
  name?: string;
  /** Updated ordered values. Omit to keep the current values. */
  values?: readonly string[];
}

export type WorkbookLinkSourceKind = 'mog-workbook' | 'excel-workbook' | 'dde-link' | 'ole-link';

export type PersistedLinkTarget =
  | { readonly kind: 'document-ref'; readonly documentId: DocumentId }
  | { readonly kind: 'open-session'; readonly sessionId: WorkbookSessionId }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'excel-external-path'; readonly target: string }
  | { readonly kind: 'opaque-host-ref'; readonly provider: string; readonly ref: string };

export interface ImportedExternalLinkIdentity {
  readonly excelOrdinal: number;
  readonly workbookRelId: string;
  readonly partName: string;
  readonly externalBookRid?: string;
  readonly target?: string;
  readonly targetMode?: 'External' | 'Internal';
}

export interface AuthorizedMaterializedCacheMetadata {
  readonly cachedValuesVersion?: string;
  readonly materializedAt?: string;
  readonly policyVersion?: string;
}

export interface PersistedWorkbookLinkRecord {
  readonly linkId: LinkId;
  readonly expectedWorkbookId: WorkbookId | null;
  readonly target: PersistedLinkTarget;
  readonly displayName: string;
  readonly sourceKind: WorkbookLinkSourceKind;
  readonly importedExcelIdentity?: ImportedExternalLinkIdentity;
  readonly materializedCacheMetadata?: AuthorizedMaterializedCacheMetadata;
}

export type UsageKind =
  | 'cellFormula'
  | 'definedName'
  | 'conditionalFormat'
  | 'dataValidation'
  | 'tableFormula'
  | 'chartExFormula'
  | 'nativeMogFormula'
  | 'diagnosticOnly';

export type LocateTarget =
  | { readonly kind: 'cell'; readonly sheetId: string; readonly address: string }
  | { readonly kind: 'range'; readonly sheetId: string; readonly range: string }
  | {
      readonly kind: 'table';
      readonly sheetId: string;
      readonly tableId: string;
      readonly range?: string;
    }
  | { readonly kind: 'sheet-object'; readonly sheetId: string; readonly objectId: string }
  | { readonly kind: 'name-manager'; readonly name: string }
  | {
      readonly kind: 'disabled';
      readonly reason: 'hiddenSheet' | 'veryHiddenSheet' | 'protectedSheet' | 'filteredOut';
    }
  | { readonly kind: 'deleted'; readonly reason: string }
  | { readonly kind: 'unsupported'; readonly reason: string };

export interface WorkbookLinkView {
  readonly linkId: LinkId;
  readonly displayName: string;
  readonly sourceKind: WorkbookLinkSourceKind;
  readonly targetDisplay: string;
  readonly canCopySource: boolean;
  readonly canRefresh: boolean;
  readonly status: LinkStatusView;
  readonly usageCount: number;
  readonly lastResolvedAt?: string;
  readonly hasEverResolved: boolean;
}

export interface WorkbookExternalLinkUsageView {
  readonly linkId: LinkId;
  readonly usageId: string;
  readonly usageKind: UsageKind;
  readonly sheetId?: string;
  readonly sheetName?: string;
  readonly address?: string;
  readonly objectId?: string;
  readonly expressionPreview?: string;
  readonly targetDisplay?: string;
  readonly locate: LocateTarget;
}

export interface WorkbookExternalPackageArtifactView {
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly partName: string;
  readonly diagnostic: string;
  readonly tombstoned: boolean;
}

export type CopyWorkbookLinkSourceResult =
  | { readonly type: 'copied'; readonly linkId: LinkId; readonly copiedText: string }
  | {
      readonly type: 'denied';
      readonly linkId: LinkId;
      readonly deniedReason: 'permissionDenied' | 'redacted' | 'unsupportedLinkKind';
    };

export interface WorkbookLinkStatusScope {
  readonly requestingDocumentId: DocumentId;
  readonly requestingSessionId: WorkbookSessionId;
  readonly actor: ActorId;
  readonly principal: AccessPrincipal;
}

export interface CreateWorkbookLinkInput {
  readonly linkId?: LinkId;
  readonly expectedWorkbookId?: WorkbookId | null;
  readonly target: PersistedLinkTarget;
  readonly displayName: string;
  readonly sourceKind: WorkbookLinkSourceKind;
  readonly importedExcelIdentity?: ImportedExternalLinkIdentity;
  readonly materializedCacheMetadata?: AuthorizedMaterializedCacheMetadata;
}

export interface UpdateWorkbookLinkInput {
  readonly expectedWorkbookId?: WorkbookId | null;
  readonly target?: PersistedLinkTarget;
  readonly displayName?: string;
  readonly sourceKind?: WorkbookLinkSourceKind;
  readonly importedExcelIdentity?: ImportedExternalLinkIdentity;
  readonly materializedCacheMetadata?: AuthorizedMaterializedCacheMetadata;
}

export interface RetargetWorkbookLinkInput {
  readonly target: PersistedLinkTarget;
  readonly expectedWorkbookId?: WorkbookId | null;
  readonly displayName?: string;
  readonly sourceKind?: WorkbookLinkSourceKind;
  readonly materializedCacheMetadata?: AuthorizedMaterializedCacheMetadata;
}

export interface BreakWorkbookLinkOptions {
  readonly mode: 'delete-record-only';
}

export interface WorkbookLinks {
  list(): readonly WorkbookLinkView[];
  get(linkId: LinkId): WorkbookLinkView | null;
  add(input: CreateWorkbookLinkInput): WorkbookLinkView;
  create(input: CreateWorkbookLinkInput): WorkbookLinkView;
  retarget(linkId: LinkId, input: RetargetWorkbookLinkInput): WorkbookLinkView;
  update(linkId: LinkId, input: UpdateWorkbookLinkInput): WorkbookLinkView;
  break(linkId: LinkId, options: BreakWorkbookLinkOptions): boolean;
  delete(linkId: LinkId): boolean;
  getStatus(linkId: LinkId): LinkStatusView;
  refresh(linkId: LinkId): Promise<LinkStatusView>;
  refreshAll(options?: { readonly concurrency?: number }): Promise<readonly LinkStatusView[]>;
  watchStatus(linkId: LinkId, handler: (status: LinkStatusView) => void): () => void;
  getUsages(linkId: LinkId): Promise<readonly WorkbookExternalLinkUsageView[]>;
  copySource(linkId: LinkId): Promise<CopyWorkbookLinkSourceResult>;
  listPackageDiagnostics(): Promise<readonly WorkbookExternalPackageArtifactView[]>;
}

export interface Workbook {
  // ===========================================================================
  // Platform state
  // ===========================================================================

  /** Whether the workbook is in auto-save mode. Always false until auto-save is implemented. */
  readonly autoSave: boolean;

  /** Whether the workbook uses system (culture-derived) separators. system separator behavior. */
  readonly useSystemSeparators: boolean;

  /**
   * Whether the workbook has unsaved changes.
   * Set to `true` automatically when any mutation occurs. Call `markClean()` after saving.
   */
  readonly isDirty: boolean;

  /** Reset the dirty flag (call after a successful save). */
  markClean(): void;

  /**
   * Whether this workbook was previously saved to storage.
   * True when created from a source (e.g. XLSX import), false when created fresh.
   */
  readonly previouslySaved: boolean;

  // ===========================================================================
  // Sheet access
  // ===========================================================================

  /**
   * Get a sheet by name (case-insensitive). ASYNC — resolves name via Rust.
   *
   * This is the primary sheet accessor for agents, LLMs, and app code.
   * For internal code that already has a SheetId, use `getSheetById()`.
   */
  getSheet(name: string): Promise<Worksheet>;

  /** Get a sheet by internal SheetId. SYNC — no IPC needed. Throws KernelError if not found. */
  getSheetById(sheetId: SheetId): Worksheet;

  /**
   * Find a worksheet by name (case-insensitive), returning null if not found.
   * Non-throwing alternative to {@link getSheet}.
   *
   * @param name - Sheet name (case-insensitive)
   * @returns The worksheet, or null if no sheet with that name exists
   */
  findSheet(name: string): Promise<Worksheet | null>;

  /** Get a sheet by 0-based index. ASYNC — resolves index via Rust. */
  getSheetByIndex(index: number): Promise<Worksheet>;

  /** The currently active sheet. SYNC — uses known activeSheetId. */
  readonly activeSheet: Worksheet;

  /**
   * Get a sheet by name, creating it if it doesn't exist.
   *
   * @param name - Sheet name (case-insensitive lookup)
   * @returns The sheet and whether it was newly created
   */
  getOrCreateSheet(name: string): Promise<{ sheet: Worksheet; created: boolean }>;

  /** Get all worksheets in display order. ASYNC — resolves each sheet by name. */
  getSheets(): Promise<Worksheet[]>;

  /** Number of sheets in the workbook. SYNC — cached, updated on sheet mutations. */
  readonly sheetCount: number;

  /** Names of all sheets in display order. SYNC — cached, updated on sheet mutations. */
  readonly sheetNames: string[];

  /** Get the count of sheets. Convenience wrapper around sheetCount property. */
  getSheetCount(): Promise<number>;
  /** Get all sheet names in display order. Convenience wrapper around sheetNames property. */
  getSheetNames(): Promise<string[]>;

  // ===========================================================================
  // Orchestration -- everyone needs these
  // ===========================================================================

  /**
   * Execute a group of operations as a single undo step.
   *
   * NOT transactional: if an operation throws, prior writes in the group remain committed.
   * Each mutation within the group still triggers its own recalc pass.
   */
  undoGroup<T = void>(fn: (wb: Workbook) => Promise<T>): Promise<T>;

  /**
   * Execute a group of operations as a single undo step with a label.
   *
   * Like `undoGroup`, but attaches a human-readable label to the undo entry
   * (e.g. "Import data"). NOT transactional: partial writes remain committed
   * if fn throws. Each mutation still triggers its own recalc pass.
   */
  batch<T = void>(label: string, fn: (wb: Workbook) => Promise<T>): Promise<T>;

  /** Create a named checkpoint (version snapshot). Returns the checkpoint ID. */
  createCheckpoint(label?: string): string;

  /** Restore the workbook to a previously saved checkpoint. */
  restoreCheckpoint(id: string): Promise<void>;

  /** List all saved checkpoints. */
  listCheckpoints(): CheckpointInfo[];

  // ===========================================================================
  // Calculation control
  // ===========================================================================

  /**
   * Current calculation engine state.
   * - 'done' — all formulas are up-to-date
   * - 'calculating' — recalculation is in progress
   * - 'pending' — dirty cells exist but recalc hasn't started (e.g., manual mode)
   */
  readonly calculationState: 'done' | 'calculating' | 'pending';

  /**
   * Trigger recalculation of formulas.
   *
   * For circular references (common in financial models — debt schedules, tax shields),
   * enable iterative calculation:
   *
   *   await wb.calculate({ iterative: { maxIterations: 100, maxChange: 0.001 } });
   *
   * Returns convergence metadata (hasCircularRefs, converged, iterations, maxDelta)
   * plus `recomputedCount` — the number of formula cells recomputed during this call.
   *
   * @param options - Calculation options.
   */
  calculate(options?: CalculateOptions): Promise<CalculateResult>;

  /**
   * Suspend automatic recalculation until resumeCalc() is called.
   * Mutations during suspension are accumulated and recalculated in a single pass on resume.
   */
  suspendCalc(): void;

  /**
   * Resume automatic recalculation after suspendCalc().
   * Triggers a full recalc to pick up all accumulated mutations.
   */
  resumeCalc(): Promise<void>;

  /**
   * Get the current calculation mode (auto/manual/autoNoTable).
   * Convenience accessor — equivalent to `(await getSettings()).calculationSettings.calcMode`.
   */
  getCalculationMode(): Promise<'auto' | 'autoNoTable' | 'manual'>;

  /**
   * Set the calculation mode.
   * Convenience mutator — patches `calculationSettings.calcMode`.
   */
  setCalculationMode(mode: 'auto' | 'autoNoTable' | 'manual'): Promise<void>;

  /**
   * Get whether iterative calculation is enabled for circular references.
   * Convenience accessor — equivalent to `(await getSettings()).calculationSettings.enableIterativeCalculation`.
   */
  getIterativeCalculation(): Promise<boolean>;

  /**
   * Whether to use displayed precision instead of full (15-digit) precision.
   * Convenience accessor — inverted from `calculationSettings.fullPrecision`.
   */
  getUsePrecisionAsDisplayed(): Promise<boolean>;

  /**
   * Set whether to use displayed precision.
   * Convenience mutator — inverts and patches `calculationSettings.fullPrecision`.
   */
  setUsePrecisionAsDisplayed(value: boolean): Promise<void>;

  // ===========================================================================
  // Events
  // ===========================================================================

  /** Subscribe to a workbook-level event with full type inference. Returns a CallableDisposable. */
  on<K extends keyof WorkbookEventMap>(
    event: K,
    handler: (event: WorkbookEventMap[K]) => void,
  ): CallableDisposable;
  /** Subscribe to a specific internal event type with full type inference. */
  on<T extends InternalEventType>(
    event: T,
    handler: (event: EventByType<T>) => void,
  ): CallableDisposable;
  /** Subscribe to an arbitrary event string. Handler receives unknown payload. */
  on(event: string, handler: (event: unknown) => void): CallableDisposable;

  /** Emit a workbook-level event. Used by coordinator mutations that need to notify the system of changes. */
  emit(event: SpreadsheetEvent): void;

  // ===========================================================================
  // Code execution
  // ===========================================================================

  /** Execute TypeScript/JavaScript code in the spreadsheet sandbox. */
  executeCode(code: string, options?: ExecuteOptions): Promise<CodeResult>;

  // ===========================================================================
  // Introspection
  // ===========================================================================

  /** Get a summary snapshot of the entire workbook. */
  getWorkbookSnapshot(): Promise<WorkbookSnapshot>;

  /** Get the catalog of all available spreadsheet functions. */
  getFunctionCatalog(): FunctionInfo[];

  /** Get detailed info about a specific function. */
  getFunctionInfo(name: string): FunctionInfo | null;

  /**
   * Describe multiple ranges across multiple sheets in a single IPC call.
   * Each entry returns the same LLM-formatted output as ws.describeRange().
   */
  describeRanges(
    requests: SheetRangeRequest[],
    includeStyle?: boolean,
  ): Promise<SheetRangeDescribeResult[]>;

  // ===========================================================================
  // Import / export
  // ===========================================================================

  /**
   * Export the workbook as XLSX binary data.
   *
   * Default export omits Mog-owned version metadata. Pass
   * `versionMetadata: "include"` to write a redacted Mog sidecar with the
   * current version head.
   */
  toXlsx(options?: WorkbookXlsxExportOptions): Promise<Uint8Array>;

  /**
   * Import sheets from XLSX data.
   * Accepts base64-encoded string or raw Uint8Array.
   * Returns the names of the inserted sheets (may be deduped if names collide).
   */
  insertWorksheets(data: string | Uint8Array, options?: InsertWorksheetOptions): Promise<string[]>;

  /**
   * Export the workbook as XLSX bytes and optionally write those bytes to a file.
   *
   * `save()` returns the XLSX bytes without filesystem side effects.
   * `save(path)` writes to the platform file writer and still returns the same
   * bytes. In the Node SDK, relative paths resolve from the current working directory and
   * missing parent directories are created. Invalid paths and host write
   * failures reject with `MogSdkError` details containing `requestedPath`,
   * `cwd`, and, when available, `absolutePath` and `filesystemCode`.
   *
   * Marks the workbook as clean after all configured save sinks succeed.
   */
  save(path: string): Promise<Uint8Array>;
  save(): Promise<Uint8Array>;

  /**
   * Capture a PNG screenshot of a cell range.
   *
   * @param sheet - Sheet name (e.g. "Sheet1") or Worksheet instance
   * @param range - A1-notation cell range (e.g. "A1:G10")
   * @param options - Rendering options (DPR, headers, gridlines, max dimensions)
   * @returns PNG image as a Buffer
   */
  captureScreenshot(
    sheet: Worksheet | string,
    range: string,
    options?: ScreenshotOptions,
  ): Promise<Uint8Array>;

  // ===========================================================================
  // Cross-workbook
  // ===========================================================================

  /** Copy a range from another workbook into this workbook. */
  copyRangeFrom(
    source: Workbook,
    fromRange: string,
    toRange: string,
    options?: { fromSheet?: string | Worksheet; toSheet?: string | Worksheet },
  ): Promise<void>;

  // ===========================================================================
  // Utilities (stateless, sync)
  // ===========================================================================

  /** Convert row/col to A1 address: (0, 0) -> "A1" */
  indexToAddress(row: number, col: number): string;

  /** Convert A1 address to row/col: "A1" -> { row: 0, col: 0 } */
  addressToIndex(address: string): { row: number; col: number };

  /**
   * Combine multiple range addresses into a single comma-separated address.
   * Equivalent to spreadsheet special-cell typeApplication.union().
   */
  union(...ranges: string[]): string;

  // ===========================================================================
  // Culture & Locale
  // ===========================================================================

  /**
   * Get full CultureInfo for the workbook's current culture setting.
   * Resolves the `culture` IETF tag (e.g. 'de-DE') into a complete CultureInfo
   * with number/date/currency formatting details.
   */
  getCultureInfo(): Promise<CultureInfo>;

  /** Get the decimal separator for the current culture (e.g. '.' or ','). */
  getDecimalSeparator(): Promise<string>;

  /** Get the thousands separator for the current culture (e.g. ',' or '.'). */
  getThousandsSeparator(): Promise<string>;

  /** Search all sheets for cells matching regex patterns (single IPC call). */
  searchAllSheets(
    patterns: string[],
    options?: SearchOptions,
  ): Promise<Array<SearchResult & { sheetName: string }>>;

  // ===========================================================================
  // Workbook properties (spreadsheet special-cell typeparity)
  // ===========================================================================

  /** The workbook name/filename. Read-only — comes from the platform/storage layer. */
  readonly name: string;

  /** Whether the workbook is in read-only mode. Read-only — determined by the platform layer. */
  readonly readOnly: boolean;

  /** Get whether chart data points track cell movement. Workbook chart data point tracking.. */
  getChartDataPointTrack(): Promise<boolean>;

  /** Set whether chart data points track cell movement. */
  setChartDataPointTrack(value: boolean): Promise<void>;

  // ===========================================================================
  // Workbook settings
  // ===========================================================================

  /** Get workbook-level settings. */
  getSettings(): Promise<WorkbookSettings>;
  /** Update workbook-level settings. */
  setSettings(updates: WorkbookSettingsPatch): Promise<void>;
  replaceSettings(settings: WorkbookSettings): Promise<void>;

  /**
   * Get workbook-level custom fill/sort lists.
   *
   * Returns the complete catalog: immutable built-in lists followed by
   * workbook-scoped user-defined lists.
   */
  getCustomLists(): Promise<readonly CustomList[]>;

  /** Add a user-defined custom fill/sort list. */
  addCustomList(input: WorkbookCustomListInput): Promise<CustomList>;

  /**
   * Update a user-defined custom fill/sort list.
   *
   * Returns false when the list does not exist or is built-in.
   */
  updateCustomList(id: string, updates: WorkbookCustomListUpdate): Promise<boolean>;

  /**
   * Delete a user-defined custom fill/sort list.
   *
   * Returns false when the list does not exist or is built-in.
   */
  deleteCustomList(id: string): Promise<boolean>;

  /**
   * Replace all user-defined custom fill/sort lists.
   *
   * Built-in lists are code-owned and are never persisted through this method.
   */
  setCustomLists(lists: readonly WorkbookCustomListInput[]): Promise<void>;

  // ===========================================================================
  // Custom settings (workbook settings — arbitrary KV store)
  // ===========================================================================

  /** Get a custom setting value by key. Returns null if not found. */
  getCustomSetting(key: string): Promise<string | null>;
  /** Set a custom setting value. */
  setCustomSetting(key: string, value: string): Promise<void>;
  /** Delete a custom setting by key. */
  deleteCustomSetting(key: string): Promise<void>;
  /** List all custom settings as key-value pairs. */
  listCustomSettings(): Promise<Array<{ key: string; value: string }>>;
  /** Get the number of custom settings. */
  getCustomSettingCount(): Promise<number>;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Close the workbook with optional save behavior.
   * @param closeBehavior - 'save' exports snapshot before disposing, 'skipSave' disposes immediately (default: 'skipSave')
   */
  close(closeBehavior?: 'save' | 'skipSave'): Promise<void>;

  /**
   * Dispose of the workbook and release resources.
   * If this workbook was created via `DocumentHandle.workbook()`, disposing also
   * cleans up the underlying DocumentHandle (and vice versa).
   */
  dispose(): void;

  /**
   * Async dispose for TC39 Explicit Resource Management.
   *
   * @example
   * ```typescript
   * await using wb = await createWorkbook();
   * ```
   */
  [Symbol.asyncDispose](): Promise<void>;

  /** Whether this workbook has been disposed. */
  readonly isDisposed: boolean;

  /**
   * Warnings from the XLSX import that created this workbook (e.g., unsupported features,
   * format loss). Empty array if the workbook was created blank or if there were no warnings.
   */
  readonly importWarnings: readonly DocumentImportWarning[];

  // ===========================================================================
  // Active object queries (UI state)
  // ===========================================================================

  /** Active cell. Returns null in headless/no-UI contexts. */
  getActiveCell(): { sheetId: string; row: number; col: number; address: string } | null;

  /** Currently selected range(s) as A1 address strings. Returns [] in headless. */
  getSelectedRanges(): string[];

  /** Primary selected range. Returns null in headless. */
  getSelectedRange(): string | null;

  /** Active chart object ID, or null. */
  getActiveChart(): string | null;

  /** Active shape object ID, or null. */
  getActiveShape(): string | null;

  /** Active slicer object ID, or null. */
  getActiveSlicer(): string | null;

  // ===========================================================================
  // Sub-API namespaces
  // ===========================================================================

  /** Sheet management (add, remove, move, rename, copy, hide, show) */
  readonly sheets: WorkbookSheets;
  /** Workbook-scoped slicer collection (all slicers across all sheets) */
  readonly slicers: WorkbookSlicers;
  /** Default slicer style management */
  readonly slicerStyles: WorkbookSlicerStyles;
  /** Timeline slicer style management */
  readonly timelineStyles: WorkbookTimelineStyles;
  /** Pivot table style presets and default style management. */
  readonly pivotTableStyles: WorkbookPivotTableStyles;
  /** Programmatic function invocation (workbook functions). */
  readonly functions: WorkbookFunctions;
  /** Named range CRUD */
  readonly names: WorkbookNames;
  /** What-if scenario CRUD */
  readonly scenarios: WorkbookScenarios;
  /** Undo/redo/history traversal */
  readonly history: WorkbookHistory;
  /** Version-control status and read-only diagnostics. */
  readonly version: WorkbookVersion;
  /** Table style management (add, get, update, remove, default, duplicate) */
  readonly tableStyles: WorkbookTableStyles;
  /** Cell style management (add, get, update, remove) */
  readonly cellStyles: WorkbookCellStyles;
  /** Document properties (title, author, keywords, custom properties). */
  readonly properties: WorkbookProperties;
  /** Workbook-level protection */
  readonly protection: WorkbookProtection;
  /** Data access control policies (Layer 2 security) */
  readonly security: WorkbookSecurity;

  // Session-level principal API:
  // "method not sub-API" rationale.

  /**
   * Set the active principal for this session. Pass `null` (or an empty
   * tag list) to clear.
   *
   * Semantics tied to document state, not session state: when the
   * document has no policies, this is effectively a no-op for access
   * decisions (the gated delegate's fast path skips the principal
   * entirely). Once any policy exists, `null` means anonymous — a
   * caller that never set a principal is denied, not owner.
   *
   * Accepts either a flat tag list or an `AccessPrincipal` envelope for
   * symmetry with `explainAccess` / `getEffectiveAccess`.
   */
  setActivePrincipal(principal: string[] | AccessPrincipal | null): Promise<void>;

  /** Current active principal, or `null` if none is set. */
  activePrincipal(): Promise<AccessPrincipal | null>;

  /**
   * Whether access-control enforcement is currently active on this
   * document. `false` when the policy set is empty. SDKs use this to
   * warn users who set a principal on a doc that has no policies ("you
   * set a principal but nothing will be enforced").
   */
  securityActive(): Promise<boolean>;

  /**
   * Canonicalize a tag list through the engine's intern pool and return
   * the canonical (sorted + deduped) form. Primary purpose is to
   * pre-warm the pool so the next `setActivePrincipal` with the same
   * tag set hits an existing slab — matrix-cache pointer identity stays
   * sound on the first call post-swap.
   */
  makePrincipal(tags: string[]): Promise<AccessPrincipal>;

  /** Toast/notification queue (info, warning, error, success) */
  readonly notifications: WorkbookNotifications;
  /** Theme management (workbook OOXML theme + chrome UI theme). */
  readonly theme: WorkbookTheme;
  /** Viewport region lifecycle (handle-based — create, update, dispose). */
  readonly viewport: WorkbookViewport;
  /** Workbook-level change tracking (opt-in, cross-sheet). */
  readonly changes: WorkbookChanges;
  /** Workbook-level diagnostics and audit surfaces. */
  readonly diagnostics: WorkbookDiagnostics;
  /** Cross-workbook link registry and principal-scoped runtime status. */
  readonly links: WorkbookLinks;

  /**
   * Table-aware record CRUD operations for record-backed views and apps.
   *
   * A record is a table data row. Removal clears the row's table cells; it does
   * not delete the physical worksheet row.
   */
  readonly records: IRecordsAPI;
}

/**
 * WorkbookInternal — Infrastructure-tier Workbook interface.
 *
 * Extends the app-facing Workbook with properties that only infrastructure code
 * (shell, coordinator, headless engine) should access. Apps must NOT use this interface;
 * they should use Workbook and its sub-API namespaces (wb.history, wb.notifications, etc.).
 */
export interface WorkbookInternal extends Workbook {
  // ===========================================================================
  // Narrowed sheet accessors — infrastructure code gets WorksheetWithInternals
  // ===========================================================================

  getSheet(name: string): Promise<WorksheetWithInternals>;
  getSheetById(sheetId: SheetId): WorksheetWithInternals;
  findSheet(name: string): Promise<WorksheetWithInternals | null>;
  getSheetByIndex(index: number): Promise<WorksheetWithInternals>;
  readonly activeSheet: WorksheetWithInternals;
  getOrCreateSheet(name: string): Promise<{ sheet: WorksheetWithInternals; created: boolean }>;

  /** Get or create a cached WorksheetImpl for a sheetId. Infrastructure-only. */
  _getOrCreateWorksheet(sheetId: SheetId, name?: string): WorksheetWithInternals;

  /** Emit a workbook-level event. Infrastructure-only — used by coordinator mutations. */
  emit(event: SpreadsheetEvent): void;

  /** Set the undo description for the next mutation. Infrastructure-only. */
  setPendingUndoDescription(description: string): void;

  /** Set the selection checkpoint for undo. Infrastructure-only. */
  setPendingSelectionCheckpoint(checkpoint: SelectionCheckpoint): void;

  /** Pivot table computation bridge. Infrastructure-only. */
  readonly pivot: IPivotBridge;

  /** Chart management bridge (rendering, data resolution, caching). Infrastructure-only. */
  readonly charts: IChartBridge;

  /** Ink recognition bridge (shape and text recognition). Null if not available. Infrastructure-only. */
  readonly ink: IInkRecognitionBridge | null;

  /** Create a calculator context for formula evaluation. Infrastructure-only. */
  createCalculatorContext(sheetId: SheetId): unknown;

  /** No-op: all recalculation is handled by Rust compute-core. Infrastructure-only. */
  recalculateAll(sheetId: SheetId, origin?: string): void;

  /** No-op: all recalculation is handled by Rust compute-core. Infrastructure-only. */
  recalculateSheet(sheetId: SheetId, origin?: string): void;

  /** @deprecated Use calculate({ iterative: ... }) instead. Infrastructure-only. */
  setIterativeCalculation(enabled: boolean): Promise<void>;

  /** @deprecated Use calculate({ iterative: { maxIterations: n } }) instead. Infrastructure-only. */
  setMaxIterations(n: number): Promise<void>;

  /** @deprecated Use calculate({ iterative: { maxChange: threshold } }) instead. Infrastructure-only. */
  setConvergenceThreshold(threshold: number): Promise<void>;

  /** Kernel services (clipboard, undo, notifications, query executor). Infrastructure-only. */
  readonly services: IKernelServices;

  /** Refresh cached sheet metadata (name, index, visibility) from Rust. Infrastructure-only. */
  refreshSheetMetadata(): Promise<void>;

  /** Get the current active sheet ID. Infrastructure-only. */
  getActiveSheetId(): SheetId;

  /** Set the active sheet ID. Infrastructure-only. */
  setActiveSheetId(id: SheetId): void;

  /** Floating object manager — full CRUD + spatial queries. Infrastructure-only. */
  readonly floatingObjects: IFloatingObjectManager;

  /**
   * Sync read view of the kernel state mirror — bounded direct workbook/
   * sheet state. Use for sync hook initializers (`useState(() =>
   * wb.mirror.getFrozenPanes(sheetId))`) and renderer per-frame reads.
   *
   * The mirror is populated by `MutationResultHandler.applyAndNotify` BEFORE
   * any event emission, so subscribers re-rendering on events read
   * post-mutation state on their first re-read (Pillar 1).
   *
   * Async `ws.view.getX()` / `ws.print.getX()` getters route through the
   * same mirror — no Rust IPC for in-scope direct fields. The mirror is
   * the single sync read view for direct state, complementing
   * BinaryViewportBuffer (which is the windowed sync read view for cell
   * values).
   *
   */
  readonly mirror: MirrorReadView;

  /**
   * Inject a code-executor factory.  The factory is called lazily on first
   * `executeCode()` invocation.  Infrastructure-only — used by engine layers
   * to wire a VM executor without creating a circular dependency.
   */
  setCodeExecutorFactory(
    factory: (config: { ctx: unknown; eventBus: unknown; getActiveSheetId: () => SheetId }) => {
      execute(code: string, options?: CodeExecutionOptions): Promise<CodeExecutionResult>;
      cancelExecution?(executionId: string): void;
      dispose(): void;
    },
  ): void;
}
