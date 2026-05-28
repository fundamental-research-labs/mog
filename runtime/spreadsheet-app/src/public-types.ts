import type { Workbook } from '@mog-sdk/contracts/api';
import type { RibbonVisibilityConfig } from '@mog-sdk/contracts/ribbon';
import type { CSSProperties, ReactNode } from 'react';

export type CommandBarTabId =
  | 'home'
  | 'insert'
  | 'draw'
  | 'page'
  | 'formulas'
  | 'data'
  | 'review'
  | 'view';

export type HostCommandOwner = 'host' | 'mog' | 'disabled';
export type SpreadsheetAppStatus = 'loading' | 'ready' | 'error' | 'recovering' | 'disposed';
export type SpreadsheetWorkbookStatus = SpreadsheetAppStatus | 'stale';
export type SpreadsheetActorKind = 'host' | 'user' | 'agent' | 'automation' | 'system';
export type SpreadsheetPolicyDecision = 'allowed' | 'denied' | 'approval-required';
export type SpreadsheetEditLevel = 'none' | 'read' | 'write' | 'approval-required';
export type SpreadsheetSlotName = 'below-command-bar' | 'above-grid' | (string & {});
export type SpreadsheetWriteScope = 'human-ui' | 'agent' | 'automation';
export type WorkbookSessionId = string;
export type OpenWorkbookId = WorkbookSessionId;
export type SemanticWorkbookId = string;
export type MogSpreadsheetColorScheme = 'light' | 'dark' | 'system';
export type MogSpreadsheetResolvedColorScheme = 'light' | 'dark';

export type SpreadsheetReadCapability = 'workbook:read' | 'workbook:export' | 'workbook:screenshot';
export type SpreadsheetWriteCapability =
  | 'workbook:write'
  | 'workbook:undo-group'
  | 'workbook:policy-admin'
  | 'decorations:write';
export type SpreadsheetCapability = SpreadsheetReadCapability | SpreadsheetWriteCapability;

export type SpreadsheetDocumentSource =
  | { readonly kind: 'blank' }
  | {
      readonly kind: 'xlsx-bytes';
      readonly bytes: Uint8Array | ArrayBuffer;
      readonly fileName?: string;
      readonly versionId?: string;
    }
  | {
      readonly kind: 'csv-bytes';
      readonly bytes: Uint8Array | ArrayBuffer;
      readonly fileName?: string;
    };

export interface SpreadsheetActorRef {
  readonly actorId: string;
  readonly kind?: SpreadsheetActorKind;
  readonly displayName?: string;
}

export interface SpreadsheetResolvedActor {
  readonly actorId: string;
  readonly kind: SpreadsheetActorKind;
  readonly displayName?: string;
  readonly principalId?: string;
}

export interface SpreadsheetResourceRef {
  readonly kind: 'workbook' | 'sheet' | 'range' | 'command' | 'decoration' | (string & {});
  readonly id?: string;
  readonly sheet?: string;
  readonly range?: string;
}

export interface SpreadsheetCapabilityContext {
  readonly sessionId: string;
  readonly workbookSessionId: WorkbookSessionId;
  readonly workbookId: string;
  readonly epoch: number;
  readonly attached: boolean;
  readonly operation: string;
  readonly resource?: SpreadsheetResourceRef;
}

export interface SpreadsheetCapabilityIntent {
  readonly operation: string;
  readonly resource?: SpreadsheetResourceRef;
}

export interface SpreadsheetApprovalRequest {
  readonly requestId: string;
  readonly actor: SpreadsheetResolvedActor;
  readonly capability: SpreadsheetCapability;
  readonly context: SpreadsheetCapabilityContext;
}

export type SpreadsheetApprovalResult =
  | { readonly decision: 'approved'; readonly requestId: string }
  | {
      readonly decision: 'denied' | 'cancelled' | 'timeout';
      readonly requestId: string;
      readonly reason?: string;
    };

export type SpreadsheetAuthorizationResult =
  | { readonly decision: 'allowed'; readonly policyVersion: string; readonly route?: string }
  | {
      readonly decision: 'approval-required';
      readonly policyVersion: string;
      readonly approvalRequest: SpreadsheetApprovalRequest;
    }
  | { readonly decision: 'denied'; readonly policyVersion: string; readonly reason: string };

export interface SpreadsheetHostAuthority {
  resolveActor(
    ref: SpreadsheetActorRef,
    context: SpreadsheetCapabilityContext,
  ): Promise<SpreadsheetResolvedActor> | SpreadsheetResolvedActor;
  authorize(
    actor: SpreadsheetResolvedActor,
    capability: SpreadsheetCapability,
    context: SpreadsheetCapabilityContext,
  ): Promise<SpreadsheetAuthorizationResult> | SpreadsheetAuthorizationResult;
}

export interface SpreadsheetAppError {
  readonly kind:
    | 'ImportFailed'
    | 'ExportFailed'
    | 'SaveFailed'
    | 'AuthorizationDenied'
    | 'ApprovalRequired'
    | 'StaleEpoch'
    | 'Disposed'
    | 'AlreadyAttached'
    | 'AttachFailed'
    | 'DetachFailed'
    | 'RuntimeError';
  readonly message: string;
  readonly recoverable: boolean;
  readonly runtimeId?: string;
  readonly attachmentId?: string;
  readonly workbookId?: string;
  readonly epoch?: number;
  readonly operation?: string;
  readonly actor?: SpreadsheetActorRef;
  readonly staleHandleImpact?: 'none' | 'current-workbook' | 'all-workbooks';
  readonly cause?: unknown;
}

export type SpreadsheetLifecycleErrorKind =
  | 'Disposed'
  | 'StaleEpoch'
  | 'AlreadyAttached'
  | 'AttachFailed'
  | 'DetachFailed';

export interface SpreadsheetLifecycleError extends SpreadsheetAppError {
  readonly kind: SpreadsheetLifecycleErrorKind;
}

export interface SpreadsheetDisposedError extends SpreadsheetLifecycleError {
  readonly kind: 'Disposed';
}

export interface SpreadsheetStaleEpochError extends SpreadsheetLifecycleError {
  readonly kind: 'StaleEpoch';
}

export interface SpreadsheetAlreadyAttachedError extends SpreadsheetLifecycleError {
  readonly kind: 'AlreadyAttached';
}

export interface SpreadsheetAttachFailedError extends SpreadsheetLifecycleError {
  readonly kind: 'AttachFailed';
}

export interface SpreadsheetDetachFailedError extends SpreadsheetLifecycleError {
  readonly kind: 'DetachFailed';
}

export type Disposed = SpreadsheetDisposedError;
export type StaleEpoch = SpreadsheetStaleEpochError;
export type AlreadyAttached = SpreadsheetAlreadyAttachedError;
export type AttachFailed = SpreadsheetAttachFailedError;
export type DetachFailed = SpreadsheetDetachFailedError;

export type SpreadsheetSaveState =
  | {
      readonly status: 'clean';
      readonly workbookId: string;
      readonly epoch: number;
      readonly versionId?: string;
    }
  | {
      readonly status: 'dirty';
      readonly workbookId: string;
      readonly epoch: number;
      readonly dirtyEpoch: number;
      readonly changeSequence: number;
      readonly baseVersionId?: string;
    }
  | {
      readonly status: 'saving';
      readonly workbookId: string;
      readonly epoch: number;
      readonly dirtyEpoch: number;
      readonly changeSequence: number;
      readonly saveRequestId: string;
      readonly baseVersionId?: string;
      readonly bytesHash: string;
      readonly requestedAt: number;
    }
  | {
      readonly status: 'error';
      readonly workbookId: string;
      readonly epoch: number;
      readonly dirtyEpoch?: number;
      readonly changeSequence?: number;
      readonly error: SpreadsheetAppError;
      readonly versionId?: string;
    };

export type SpreadsheetDirtyState =
  | {
      readonly status: 'clean';
      readonly workbookId: string;
      readonly epoch: number;
      readonly changeSequence: number;
      readonly versionId?: string;
    }
  | {
      readonly status: 'dirty';
      readonly workbookId: string;
      readonly epoch: number;
      readonly dirtyEpoch: number;
      readonly changeSequence: number;
      readonly baseVersionId?: string;
    };

export interface SpreadsheetSaveRequest {
  readonly workbookId: string;
  readonly epoch: number;
  readonly dirtyEpoch: number;
  readonly changeSequence: number;
  readonly saveRequestId: string;
  readonly baseVersionId?: string;
  readonly bytes: Uint8Array;
  readonly bytesHash: string;
}

export interface SpreadsheetExportRequest {
  readonly workbookId: string;
  readonly epoch: number;
  readonly format: 'xlsx' | 'csv' | 'pdf';
  readonly bytes?: Uint8Array;
  readonly bytesHash?: string;
}

export type SpreadsheetSaveResult =
  | {
      readonly status: 'saved';
      readonly workbookId: string;
      readonly epoch: number;
      readonly baseVersionId?: string;
      readonly dirtyEpoch: number;
      readonly changeSequence: number;
      readonly saveRequestId: string;
      readonly bytesHash: string;
      readonly versionId?: string;
    }
  | {
      readonly status: 'failed' | 'stale' | 'disposed';
      readonly workbookId: string;
      readonly epoch: number;
      readonly baseVersionId?: string;
      readonly dirtyEpoch: number;
      readonly changeSequence: number;
      readonly saveRequestId: string;
      readonly bytesHash: string;
      readonly error: SpreadsheetAppError;
    };

export interface SpreadsheetSelectionSnapshot {
  readonly workbookId: string;
  readonly epoch: number;
  readonly activeSheetId?: string;
  readonly selectedRanges: readonly string[];
  readonly activeCell?: {
    readonly sheetId: string;
    readonly row: number;
    readonly col: number;
    readonly address: string;
  } | null;
}

export interface SpreadsheetFocusSnapshot {
  readonly focused: boolean;
}

export interface SpreadsheetActiveSheetSnapshot {
  readonly workbookId: string;
  readonly epoch: number;
  readonly sheetId: string;
  readonly sheetName?: string;
}

export interface SpreadsheetScreenshotOptions {
  readonly scale?: number;
  readonly background?: 'transparent' | 'workbook' | string;
  readonly format?: 'png';
}

export interface SpreadsheetPolicySnapshot {
  readonly actor: SpreadsheetResolvedActor;
  readonly workbookId: string;
  readonly epoch: number;
  readonly decisions: readonly {
    readonly capability: SpreadsheetCapability;
    readonly decision: SpreadsheetPolicyDecision;
  }[];
}

export interface SpreadsheetCommandRequest {
  readonly command: 'save' | 'export' | 'open' | 'share' | 'import' | 'print';
  readonly workbookId: string;
  readonly epoch: number;
  readonly actor?: SpreadsheetActorRef;
  readonly save?: SpreadsheetSaveRequest;
  readonly export?: SpreadsheetExportRequest;
  readonly source?: SpreadsheetDocumentSource;
  readonly format?: 'xlsx' | 'csv' | 'pdf';
}

export type SpreadsheetCommandResult =
  | {
      readonly status: 'handled';
      readonly command: SpreadsheetCommandRequest['command'];
      readonly result?: unknown;
    }
  | {
      readonly status: 'denied';
      readonly command: SpreadsheetCommandRequest['command'];
      readonly reason: string;
    }
  | { readonly status: 'not-handled'; readonly command: SpreadsheetCommandRequest['command'] };

export interface SpreadsheetDecoration {
  readonly id?: string;
  readonly group?: string;
  readonly sheet: string;
  readonly range: string;
  readonly fill?: string;
  readonly border?: string;
  readonly animation?: 'none' | 'pulse' | 'shimmer';
  readonly zIndex?: number;
}

export interface SpreadsheetDecorationSnapshot {
  readonly workbookId: string;
  readonly epoch: number;
  readonly decorations: readonly Required<Pick<SpreadsheetDecoration, 'id' | 'sheet' | 'range'>>[];
}

export interface SpreadsheetDecorationHandle {
  add(decoration: SpreadsheetDecoration): string;
  addMany(decorations: readonly SpreadsheetDecoration[]): readonly string[];
  clear(id: string): void;
  clearGroup(group: string): void;
  clearAll(): void;
  list(): readonly SpreadsheetDecoration[];
}

export interface SpreadsheetSlotHandle {
  readonly name: SpreadsheetSlotName;
  set(content: ReactNode): void;
  clear(): void;
}

export type SpreadsheetSlotContributions = Partial<Record<SpreadsheetSlotName, ReactNode>>;

export interface SpreadsheetRuntimeAssetPolicy {
  readonly wasmBaseUrl?: string;
  readonly workerUrl?: string;
  readonly fontBaseUrl?: string;
  readonly staticBaseUrl?: string;
}

export type SpreadsheetPersistenceMode =
  | 'host-owned-ephemeral'
  | 'host-owned-persistent'
  | 'local-recovery';

export interface SpreadsheetRuntimeHostPolicy {
  readonly authority?: SpreadsheetHostAuthority;
  readonly principalRef?: string;
  readonly capabilityGrantRef?: string;
  readonly persistenceMode?: SpreadsheetPersistenceMode;
  /**
   * Whether to show the browser's "leave site?" prompt when there is
   * unflushed document data on `beforeunload`. Defaults to `true`.
   *
   * Set to `false` when the host manages its own unsaved-changes UX
   * or on localhost where the prompt interferes with hot reload.
   */
  readonly beforeUnloadPrompt?: boolean;
}

export interface SpreadsheetRuntimeOptions {
  readonly runtimeId?: string;
  readonly assets?: SpreadsheetRuntimeAssetPolicy;
  readonly host?: SpreadsheetRuntimeHostPolicy;
  readonly onSaveRequest?: (
    request: SpreadsheetSaveRequest,
  ) => Promise<SpreadsheetSaveResult> | SpreadsheetSaveResult;
  readonly onCommandRequest?: (
    request: SpreadsheetCommandRequest,
  ) => Promise<SpreadsheetCommandResult> | SpreadsheetCommandResult;
  readonly onApprovalRequest?: (
    request: SpreadsheetApprovalRequest,
  ) => Promise<SpreadsheetApprovalResult> | SpreadsheetApprovalResult;
  readonly onEvent?: (event: SpreadsheetAppEvent) => void;
}

export interface SpreadsheetOpenWorkbookRequest {
  /**
   * Semantic/public workbook identity. Kept for compatibility; runtime maps use
   * a separately minted workbookSessionId so raw copies can be open together.
   */
  readonly workbookId: string;
  readonly workbookSessionId?: WorkbookSessionId;
  readonly displayName?: string;
  readonly source: SpreadsheetDocumentSource;
}

export interface SpreadsheetMarkSavedInput {
  readonly epoch: number;
  readonly dirtyEpoch: number;
  readonly changeSequence: number;
  readonly saveRequestId: string;
  readonly bytesHash: string;
  readonly versionId?: string;
}

export interface MogSpreadsheetWorkspacePolicy {
  readonly mode?: 'single-document' | 'multi-document';
  readonly fileExplorer?: boolean;
  readonly appSwitcher?: boolean;
  readonly settings?: boolean;
}

export interface MogSpreadsheetCommandBarPolicy {
  readonly mode?: 'mog' | 'hidden';
  readonly tabs?: readonly CommandBarTabId[];
  readonly hiddenTabs?: readonly CommandBarTabId[];
  readonly hiddenGroups?: readonly string[];
  readonly disabledCommands?: readonly string[];
}

export interface MogSpreadsheetChromePolicy {
  readonly commandBar?: boolean | MogSpreadsheetCommandBarPolicy;
  /**
   * Controls the File menu affordance rendered next to the command bar tabs.
   * Defaults to true. Set false when the host owns file import, save, export,
   * and related page chrome.
   */
  readonly fileMenu?: boolean;
  readonly formulaBar?: boolean;
  readonly sheetTabs?: boolean;
  readonly statusBar?: boolean;
}

export interface MogSpreadsheetCommandPolicy {
  readonly save?: HostCommandOwner;
  readonly open?: HostCommandOwner;
  readonly share?: HostCommandOwner;
  readonly import?: HostCommandOwner;
  readonly export?: HostCommandOwner;
  readonly print?: HostCommandOwner;
}

export interface MogSpreadsheetFeaturePolicy {
  readonly commandBar?: boolean;
  readonly editing?: boolean;
  readonly ribbonVisibility?: RibbonVisibilityConfig;
  readonly tabs?: Partial<Record<CommandBarTabId, boolean>>;
  readonly groups?: Record<string, boolean>;
  readonly capabilities?: Record<string, boolean>;
}

export interface SpreadsheetWorkbookFacade extends Workbook {
  readonly workbookId: string;
  readonly epoch: number;
}

export interface SpreadsheetViewHandle {
  scrollTo(input: {
    readonly sheet?: string;
    readonly range?: string;
    readonly row?: number;
    readonly col?: number;
  }): Promise<void>;
  select(
    input: { readonly sheet?: string; readonly range: string },
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<void>;
  getSelection(): SpreadsheetSelectionSnapshot;
  getActiveSheet(): SpreadsheetActiveSheetSnapshot;
  setActiveSheet(
    sheetIdOrName: string,
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<void>;
  startEdit(
    input: { readonly sheet?: string; readonly address: string; readonly value?: string },
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<void>;
  commitEdit(actor?: SpreadsheetActorRef | SpreadsheetActorSession): Promise<void>;
  cancelEdit(actor?: SpreadsheetActorRef | SpreadsheetActorSession): Promise<void>;
  blur(): void;
  canExecute(
    command: SpreadsheetCommandRequest['command'],
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<SpreadsheetAuthorizationResult>;
}

export interface SpreadsheetActorSession {
  readonly actor: SpreadsheetResolvedActor;
  readonly policy: SpreadsheetPolicySnapshot;
  readonly workbookId: string;
  readonly epoch: number;
  getWorkbook(): SpreadsheetWorkbookFacade;
  requestSave(): Promise<SpreadsheetSaveResult>;
  exportXlsx(): Promise<Uint8Array>;
  captureScreenshot(
    sheet: string,
    range: string,
    options?: SpreadsheetScreenshotOptions,
  ): Promise<Uint8Array>;
  undoGroup<T>(label: string, fn: () => Promise<T> | T): Promise<T>;
  decorations(): SpreadsheetDecorationHandle | null;
  getEffectivePolicySnapshot(): Promise<SpreadsheetPolicySnapshot>;
}

export type SpreadsheetAttachmentState =
  | { readonly status: 'headless'; readonly workbookId: string; readonly epoch: number }
  | {
      readonly status: 'attaching';
      readonly workbookId: string;
      readonly epoch: number;
      readonly attachmentId: string;
    }
  | {
      readonly status: 'attached';
      readonly workbookId: string;
      readonly epoch: number;
      readonly attachmentId: string;
    }
  | {
      readonly status: 'detaching';
      readonly workbookId: string;
      readonly epoch: number;
      readonly attachmentId: string;
    }
  | {
      readonly status: 'attach-failed';
      readonly workbookId: string;
      readonly epoch: number;
      readonly attachmentId: string;
      readonly error: SpreadsheetAttachFailedError;
    }
  | {
      readonly status: 'detach-failed';
      readonly workbookId: string;
      readonly epoch: number;
      readonly attachmentId: string;
      readonly error: SpreadsheetDetachFailedError;
    }
  | { readonly status: 'disposed'; readonly workbookId: string; readonly epoch: number };

export interface SpreadsheetRuntime {
  readonly ready: Promise<void>;
  readonly runtimeId: string;
  openWorkbook(input: SpreadsheetOpenWorkbookRequest): Promise<SpreadsheetWorkbookSession>;
  getWorkbookSession(workbookSessionId: WorkbookSessionId): SpreadsheetWorkbookSession | null;
  getWorkbookSessionByWorkbookId(workbookId: string): SpreadsheetWorkbookSession | null;
  listWorkbookSessions(): readonly SpreadsheetWorkbookSession[];
  onEvent(handler: (event: SpreadsheetAppEvent) => void): () => void;
  onDisposed(handler: () => void): () => void;
  disposeWorkbook(workbookSessionId: WorkbookSessionId): Promise<void>;
  dispose(): Promise<void>;
}

export interface SpreadsheetWorkbookSession {
  readonly ready: Promise<void>;
  readonly workbookSessionId: WorkbookSessionId;
  readonly workbookId: string;
  readonly epoch: number;
  getStatus(): SpreadsheetWorkbookStatus;
  getAttachmentState(): SpreadsheetAttachmentState;
  whenReady(epoch?: number): Promise<void>;
  resolveActor(actor: SpreadsheetActorRef): Promise<SpreadsheetActorSession>;
  getWorkbook(): SpreadsheetWorkbookFacade;
  exportXlsx(actor?: SpreadsheetActorRef | SpreadsheetActorSession): Promise<Uint8Array>;
  requestSave(
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<SpreadsheetSaveResult>;
  markSaved(input: SpreadsheetMarkSavedInput): void;
  captureScreenshot(
    actor: SpreadsheetActorRef | SpreadsheetActorSession,
    sheet: string,
    range: string,
    options?: SpreadsheetScreenshotOptions,
  ): Promise<Uint8Array>;
  undoGroup<T>(
    actor: SpreadsheetActorRef | SpreadsheetActorSession,
    label: string,
    fn: () => Promise<T> | T,
  ): Promise<T>;
  decorations(
    actor: SpreadsheetActorRef | SpreadsheetActorSession,
  ): SpreadsheetDecorationHandle | null;
  getEffectivePolicySnapshot(
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<SpreadsheetPolicySnapshot>;
  onDirtyChange(handler: (state: SpreadsheetDirtyState) => void): () => void;
  onSaveStateChange(handler: (state: SpreadsheetSaveState) => void): () => void;
  onAttachmentChange(handler: (state: SpreadsheetAttachmentState) => void): () => void;
  onDisposed(handler: () => void): () => void;
  dispose(): Promise<void>;
}

export interface SpreadsheetAppAttachmentHandle {
  readonly ready: Promise<void>;
  readonly attachmentId: string;
  readonly workbookId: string;
  readonly workbook: SpreadsheetWorkbookSession;
  getStatus(): SpreadsheetAppStatus;
  view(): SpreadsheetViewHandle;
  slot(name: SpreadsheetSlotName): SpreadsheetSlotHandle;
  focus(): void;
  resize(): void;
  detach(): Promise<void>;
}

/**
 * @deprecated Use SpreadsheetWorkbookSession. Workbook lifetime is now runtime-owned,
 * and "background" is represented by SpreadsheetAttachmentState instead of a separate handle type.
 */
export type SpreadsheetWorkbookHandle = SpreadsheetWorkbookSession;

/**
 * @deprecated Use SpreadsheetAppAttachmentHandle.
 */
export type SpreadsheetAppHandle = SpreadsheetAppAttachmentHandle;

export interface SpreadsheetAppEventBase {
  readonly workbookId: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly source: SpreadsheetActorKind;
  readonly actor?: SpreadsheetActorRef;
}

export type SpreadsheetAppEvent =
  | (SpreadsheetAppEventBase & {
      readonly type: 'selection-change';
      readonly payload: SpreadsheetSelectionSnapshot;
    })
  | (SpreadsheetAppEventBase & {
      readonly type: 'focus-change';
      readonly payload: SpreadsheetFocusSnapshot;
    })
  | (SpreadsheetAppEventBase & {
      readonly type: 'active-sheet-change';
      readonly payload: SpreadsheetActiveSheetSnapshot;
    })
  | (SpreadsheetAppEventBase & {
      readonly type: 'dirty-change';
      readonly payload: SpreadsheetDirtyState;
    })
  | (SpreadsheetAppEventBase & {
      readonly type: 'save-state-change';
      readonly payload: SpreadsheetSaveState;
    })
  | (SpreadsheetAppEventBase & {
      readonly type: 'disposed';
      readonly payload: { readonly workbookId: string; readonly epoch: number };
    })
  | (SpreadsheetAppEventBase & {
      readonly type: 'decoration-change';
      readonly payload: SpreadsheetDecorationSnapshot;
    })
  | (SpreadsheetAppEventBase & { readonly type: 'error'; readonly payload: SpreadsheetAppError });

export interface MogSpreadsheetAttachmentEvents {
  onReady?: (handle: SpreadsheetAppAttachmentHandle) => void;
  onError?: (error: SpreadsheetAppError) => void;
  onSelectionChange?: (selection: SpreadsheetSelectionSnapshot) => void;
  onActiveSheetChange?: (snapshot: SpreadsheetActiveSheetSnapshot) => void;
  onEvent?: (event: SpreadsheetAppEvent) => void;
  onDisposed?: () => void;
}

export interface MogSpreadsheetThemeAxis {
  readonly colorScheme?: MogSpreadsheetColorScheme;
  readonly resolvedColorScheme?: MogSpreadsheetResolvedColorScheme;
}

export interface MogSpreadsheetThemePolicy {
  /**
   * Application chrome owned by MOG: ribbon, command bar, formula bar, sheet
   * tabs, status bar, dialogs, popovers, settings, and other UI surfaces.
   */
  readonly uiChrome?: MogSpreadsheetThemeAxis;
  /**
   * Reserved for future canvas/grid/chart chrome theming. The first
   * implementation accepts the value for host contract symmetry but preserves
   * light document/canvas rendering.
   */
  readonly canvasChrome?: MogSpreadsheetThemeAxis;
}

/**
 * @deprecated Use MogSpreadsheetAttachmentEvents. Runtime/workbook lifecycle events
 * live on SpreadsheetRuntime and SpreadsheetWorkbookSession.
 */
export type MogSpreadsheetLifecycleEvents = MogSpreadsheetAttachmentEvents;

export interface MogSpreadsheetAppProps extends MogSpreadsheetAttachmentEvents {
  readonly runtime: SpreadsheetRuntime;
  readonly workbook: SpreadsheetWorkbookSession;
  readonly workspace?: MogSpreadsheetWorkspacePolicy;
  readonly chrome?: MogSpreadsheetChromePolicy;
  readonly theme?: MogSpreadsheetThemePolicy;
  readonly commands?: MogSpreadsheetCommandPolicy;
  readonly featurePolicy?: MogSpreadsheetFeaturePolicy;
  readonly portals?: {
    readonly container?: HTMLElement;
    readonly strategy?: 'app-root' | 'host-container';
  };
  readonly editModel?: {
    readonly user?: SpreadsheetEditLevel;
    readonly agents?: SpreadsheetEditLevel;
    readonly automation?: SpreadsheetEditLevel;
  };
  readonly slots?: SpreadsheetSlotContributions;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly loadingFallback?: ReactNode;
}
