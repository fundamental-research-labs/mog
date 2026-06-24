import type { ChartImageExporter, Workbook } from '@mog-sdk/contracts/api';
import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';
import {
  createPublicVersionDomainSupportManifest,
  type DomainSupportManifest,
} from '@mog-sdk/contracts/versioning';
import type {
  AppId,
  CapabilityGrant,
  CapabilityScope,
  CapabilityType,
  GrantChangeEvent,
  GrantOptions,
} from '@mog-sdk/contracts/capabilities';
import type { CallableDisposable } from '@mog-sdk/contracts/core';
import type { DocumentHandle, DocumentHandleWorkbookConfig } from '@mog-sdk/kernel';
import type { ShellBootstrapResult } from '@mog/shell/bootstrap';

import type { Deferred } from './deferred';
import type {
  SpreadsheetDecorationHandle,
  SpreadsheetAttachmentState,
  SpreadsheetSaveRequest,
  SpreadsheetSaveState,
  SpreadsheetScreenshotOptions,
  SpreadsheetSelectionSnapshot,
  SpreadsheetWorkbookFacade,
  SpreadsheetWorkbookStatus,
} from './public-types';

export type SpreadsheetAppWorkbook = Workbook & {
  readonly activeSheet: { readonly sheetId: unknown; readonly name?: string };
  getActiveCell(): SpreadsheetSelectionSnapshot['activeCell'];
  getSelectedRanges(): string[];
  captureScreenshot(
    sheet: string,
    range: string,
    options?: SpreadsheetScreenshotOptions,
  ): Promise<Uint8Array | ArrayBuffer>;
};

type SpreadsheetAppChartImageExporterRegistrationTarget = {
  registerChartImageExporter(factory: (chartBridge: IChartBridge) => ChartImageExporter): void;
};

export type SpreadsheetAppDocumentHandle = SpreadsheetAppChartImageExporterRegistrationTarget & {
  readonly isImportDurabilityPending?: boolean;
  readonly isReadOnly?: boolean;
  readonly eventBus: {
    onAll(handler: (event: unknown) => void): (() => void) | undefined;
  };
  dispose(): Promise<void> | void;
  workbook(config?: DocumentHandleWorkbookConfig): Promise<Workbook>;
};

export type RuntimeDefaultVersioningAttachmentState =
  | { readonly status: 'attached'; readonly documentId: string }
  | {
      readonly status: 'unavailable';
      readonly documentId: string;
      readonly reason:
        | 'document-not-loaded'
        | 'document-versioning-skipped'
        | 'document-versioning-failed';
    };

const DEFAULT_VERSIONING_DECORATED_HANDLE = Symbol.for(
  '@mog-sdk/spreadsheet-app.defaultVersioningDecoratedHandle',
);
const DEFAULT_VERSION_PROVIDER_SELECTION = {
  kind: 'indexeddb',
  requireDurablePersistence: true,
} as const satisfies NonNullable<
  NonNullable<DocumentHandleWorkbookConfig['versioning']>['providerSelection']
>;
type DefaultVersionProviderSelection = NonNullable<
  NonNullable<DocumentHandleWorkbookConfig['versioning']>['providerSelection']
>;
type RuntimeDefaultVersioningDocumentHandle = DocumentHandle & {
  [DEFAULT_VERSIONING_DECORATED_HANDLE]?: true;
};

type RuntimeDocumentVersioningReadinessLike = {
  readonly status?: string;
};

function createDefaultDomainSupportManifest(documentId: string): DomainSupportManifest {
  return createPublicVersionDomainSupportManifest({ workbookId: documentId });
}

export function decorateRuntimeOwnedHandleWithDefaultVersioning(
  handle: DocumentHandle,
): DocumentHandle {
  const runtimeHandle = handle as RuntimeDefaultVersioningDocumentHandle;
  if (runtimeHandle[DEFAULT_VERSIONING_DECORATED_HANDLE]) return handle;

  const originalWorkbook = handle.workbook.bind(handle);
  runtimeHandle.workbook = ((config?: DocumentHandleWorkbookConfig) =>
    originalWorkbook({
      ...config,
      versioning: {
        providerSelection: createDefaultVersionProviderSelection(handle),
        domainSupportManifest: createDefaultDomainSupportManifest(handle.documentId),
        ...config?.versioning,
      },
    })) as DocumentHandle['workbook'];
  Object.defineProperty(runtimeHandle, DEFAULT_VERSIONING_DECORATED_HANDLE, {
    configurable: false,
    enumerable: false,
    value: true,
  });
  return handle;
}

function createDefaultVersionProviderSelection(
  handle: Pick<DocumentHandle, 'isImportDurabilityPending' | 'isReadOnly'>,
): DefaultVersionProviderSelection {
  return {
    ...DEFAULT_VERSION_PROVIDER_SELECTION,
    ...(handle.isReadOnly === true ? { readOnly: true } : {}),
    ...(handle.isImportDurabilityPending === true ? { initializeTiming: 'deferred' as const } : {}),
  };
}

export function attachRuntimeDefaultVersioning(environment: {
  readonly documentId: string;
  readonly shell: ShellBootstrapResult;
  readonly documentVersioning?: RuntimeDocumentVersioningReadinessLike;
}): RuntimeDefaultVersioningAttachmentState {
  if (environment.documentVersioning?.status === 'skipped') {
    return {
      status: 'unavailable',
      documentId: environment.documentId,
      reason: 'document-versioning-skipped',
    };
  }
  if (environment.documentVersioning?.status === 'failed') {
    return {
      status: 'unavailable',
      documentId: environment.documentId,
      reason: 'document-versioning-failed',
    };
  }

  const handle = environment.shell.documentManager.getDocument(environment.documentId);
  if (!handle) {
    return {
      status: 'unavailable',
      documentId: environment.documentId,
      reason: 'document-not-loaded',
    };
  }
  if (!environment.documentVersioning) {
    decorateRuntimeOwnedHandleWithDefaultVersioning(handle);
  }
  return { status: 'attached', documentId: environment.documentId };
}

export type SpreadsheetAppCapabilityRegistry = {
  dispose(): void;
  [Symbol.dispose](): void;
  on<K extends keyof SpreadsheetAppCapabilityEventMap>(
    event: K,
    handler: (data: SpreadsheetAppCapabilityEventMap[K]) => void,
  ): CallableDisposable;
  once<K extends keyof SpreadsheetAppCapabilityEventMap>(
    event: K,
    handler: (data: SpreadsheetAppCapabilityEventMap[K]) => void,
  ): CallableDisposable;
  hasCapability(
    appId: AppId,
    capability: CapabilityType,
    scope?: { resourceType: string; resourceId: string },
  ): boolean;
  getGrants(appId: AppId): readonly CapabilityGrant[];
  getEffectiveCapabilities(appId: AppId): CapabilityType[];
  grant(appId: AppId, capability: CapabilityType, options?: GrantOptions): void;
  grantBatch(appId: AppId, capabilities: readonly CapabilityType[], options?: GrantOptions): void;
  revoke(appId: AppId, capability: CapabilityType): void;
  revokeAll(appId: string): number;
  expandCapabilities(capabilities: readonly CapabilityType[]): CapabilityType[];
  isCapabilityScoped(appId: AppId, capability: CapabilityType): boolean;
  getCapabilityScope(appId: AppId, capability: CapabilityType): CapabilityScope | null;
  cleanupExpired(): number;
  subscribeToApp(appId: AppId, callback: (event: GrantChangeEvent) => void): () => void;
  subscribeToAll(callback: (event: GrantChangeEvent) => void): () => void;
};

export type SpreadsheetAppCapabilityRegistryEvent = {
  readonly type: 'capability:granted' | 'capability:revoked';
  readonly appId: AppId;
  readonly capability: CapabilityType;
  readonly grant?: CapabilityGrant;
  readonly timestamp: number;
};

export type SpreadsheetAppCapabilityEventMap = {
  readonly 'capability:granted': SpreadsheetAppCapabilityRegistryEvent;
  readonly 'capability:revoked': SpreadsheetAppCapabilityRegistryEvent;
};

export type WorkbookRecord = {
  readonly workbookSessionId: string;
  readonly documentId: string;
  readonly workbookId: string;
  epoch: number;
  readonly foreground: boolean;
  handle: SpreadsheetAppDocumentHandle;
  workbook: SpreadsheetAppWorkbook;
  facade: SpreadsheetWorkbookFacade;
  status: SpreadsheetWorkbookStatus;
  saveState: SpreadsheetSaveState;
  readonly pendingSaves: Map<string, SpreadsheetSaveRequest>;
  changeSequence: number;
  dirtyEpoch: number | null;
  versionId?: string;
  readonly ready: Promise<void>;
  readonly decorations: SpreadsheetDecorationHandle;
  readonly dirtyListeners: Set<(state: import('./public-types').SpreadsheetDirtyState) => void>;
  readonly saveListeners: Set<(state: SpreadsheetSaveState) => void>;
  attachmentState: SpreadsheetAttachmentState;
  readonly attachmentListeners: Set<(state: SpreadsheetAttachmentState) => void>;
  readonly disposedListeners: Set<() => void>;
  unsubscribeEvents?: () => void;
  unsubscribeAppBridge?: () => void;
  disposePromise?: Promise<void>;
};

export type RuntimeState = {
  readonly shell: ShellBootstrapResult;
  appKernel: IAppKernelAPI;
  readonly documentId: string;
  readonly sessionId: string;
  readonly workbookSessionId: string;
  foreground: WorkbookRecord;
  readonly records: Map<string, WorkbookRecord>;
  readonly epochReady: Map<number, Deferred<void>>;
  readonly appBridges: Map<string, RegisteredSpreadsheetAppBridge>;
};

export type RegisteredSpreadsheetAppBridge = {
  readonly documentId: string;
  getSelection(): Omit<SpreadsheetSelectionSnapshot, 'workbookId' | 'epoch'> & {
    readonly activeSheetId?: string;
  };
  getActiveSheet(): { readonly sheetId: string; readonly sheetName?: string };
  setActiveSheet(sheetIdOrName: string): Promise<void>;
  select(input: { readonly sheet?: string; readonly range: string }): Promise<void>;
  scrollTo(input: {
    readonly sheet?: string;
    readonly range?: string;
    readonly row?: number;
    readonly col?: number;
  }): Promise<void>;
  startEdit(input: {
    readonly sheet?: string;
    readonly address: string;
    readonly value?: string;
  }): Promise<void>;
  commitEdit(): Promise<void>;
  cancelEdit(): Promise<void>;
  onSelectionChange(
    handler: (snapshot: Omit<SpreadsheetSelectionSnapshot, 'workbookId' | 'epoch'>) => void,
  ): () => void;
  onActiveSheetChange(
    handler: (snapshot: { readonly sheetId: string; readonly sheetName?: string }) => void,
  ): () => void;
};
