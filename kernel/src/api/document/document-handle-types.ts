import type { ChartImageExporter, Workbook, WorkbookStateProvider } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { DocumentImportWarning } from '@mog-sdk/contracts/document';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import type { ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import type { PivotExpansionStateProvider } from '@mog-sdk/contracts/pivot';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import type { IUndoService } from '@mog-sdk/contracts/services';
import type {
  CheckpointResult,
  CloseResult,
  DocumentStorageState,
} from '@mog-sdk/types-document/storage/lifecycle';
import type { TrapError } from '@mog/transport';
import type { PresenceState, RoomSnapshot, SidecarStatus } from '../../document/collab/ws-sidecar';
import type { DocumentByteSyncPort, Provider } from '../../document/providers/provider';
import type { DocumentWorkbookVersioningLifecycleConfig } from '../../document/version-store/lifecycle';

export interface DocumentHandleTrapRecovery {
  onTrap(listener: (trap: TrapError) => void): () => void;
  sendTrap(trap: TrapError): void;
  recover(yrsState?: Uint8Array): Promise<void>;
}

export interface DocumentHandleWorkbookConfig {
  stateProvider?: WorkbookStateProvider;
  featureGates?: FeatureGates;
  readFeatureGates?: () => FeatureGates;
  previouslySaved?: boolean;
  name?: string;
  readOnly?: boolean;
  onSave?: (buffer: Uint8Array) => Promise<void>;
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  importWarnings?: readonly DocumentImportWarning[];
  versioning?: DocumentWorkbookVersioningLifecycleConfig;
}

export interface CollaborationSidecarConfig {
  url: string;
  participantId: string;
  preflightStateVector?: Uint8Array;
  preflightRoomEpoch?: number;
}

export interface CollaborationDocumentCreateOptions {
  url: string;
  participantId: string;
  documentId?: string;
  environment?: 'browser' | 'headless';
  napiAddon?: unknown;
  security?: DocumentSecurityConfig;
  userTimezone?: string;
}

export interface CollaborationSidecar {
  readonly status: SidecarStatus;
  readonly participants: ReadonlyMap<string, PresenceState>;
  onStatusChange(cb: (status: SidecarStatus) => void): () => void;
  setPresence(state: PresenceState): void;
  onPresenceChange(cb: (participants: ReadonlyMap<string, PresenceState>) => void): () => void;
  detach(): void;
  flushAndDetach?(options?: { readonly timeoutMs?: number }): Promise<void>;
}

export type {
  PresenceState as CollaborationPresenceState,
  RoomSnapshot as CollaborationRoomSnapshot,
  SidecarStatus as CollaborationSidecarStatus,
};

export interface DocumentHandle {
  readonly documentId: string;
  readonly initialSheetId: SheetId;
  readonly importWarnings: readonly DocumentImportWarning[];
  readonly isDisposed: boolean;
  dispose(): Promise<void>;
  disposeAsync(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
  workbook(): Promise<Workbook>;
  workbook(config: DocumentHandleWorkbookConfig): Promise<Workbook>;
  readonly eventBus: IEventBus;
  readonly undoService: IUndoService | undefined;
  registerPivotExpansionProvider(provider: PivotExpansionStateProvider): void;
  registerChartImageExporter(factory: (chartBridge: IChartBridge) => ChartImageExporter): void;
  attachCollaborationSidecar(config: CollaborationSidecarConfig): Promise<CollaborationSidecar>;
  flushSync(): void;
  readonly pendingUpdatesCount: number;
  readonly hasFlushFailed: boolean;
  readonly hasAppendActive: boolean;
  readonly isReadOnly: boolean;
  scheduleDeferredHydration(): Promise<void>;
  ensureDeferredHydration(): Promise<void>;
  awaitMaterialized(scope?: SheetId | 'allSheets'): Promise<void>;
  readonly isImportDurabilityPending: boolean;
  awaitImportDurability(): Promise<void>;
  attachStorageProvider(provider: Provider): Promise<void>;
  readonly storageState: DocumentStorageState;
  checkpoint(): Promise<CheckpointResult>;
  close(): Promise<CloseResult>;
}

export interface DocumentHandleInternal extends DocumentHandle {
  readonly context: ISpreadsheetKernelContext;
  createSyncPort(): DocumentByteSyncPort;
  readonly _trapRecovery: DocumentHandleTrapRecovery;
  _devtoolsProviders(): readonly Provider[];
}
