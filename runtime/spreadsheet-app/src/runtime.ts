import { createShell, type ShellBootstrapConfig } from '@mog/shell/bootstrap';
import { createPermissiveShellCapabilityRegistry } from '@mog/shell/capabilities';
import { createAppKernelAPIFromHandle } from '@mog-sdk/kernel/app-api';
import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import type { DocumentHandle } from '@mog-sdk/kernel';

import {
  SPREADSHEET_ACTOR_SESSION_BRAND,
  type ActorSessionBrand,
  type InternalSpreadsheetActorSession,
} from './actor-session';
import { cloneBytes, hashBytes, makeCleanState } from './bytes';
import { createRuntimeId, noopDisposable } from './deferred';
import { InternalDecorationHandle } from './decorations';
import { shouldTrackWorkbookDirtyEvent } from './dirty-events';
import {
  SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER,
  type SpreadsheetAttachmentCommandRequest,
  type SpreadsheetAttachmentCommandResult,
  type SpreadsheetRuntimeDocumentVersioningReadiness,
  type SpreadsheetRuntimeAttachmentController,
  type SpreadsheetRuntimeAttachmentEnvironment,
  type SpreadsheetRuntimeAttachRequest,
  type SpreadsheetRuntimeWithAttachmentController,
} from './attachment-runtime';
import { resolveCommandOwner } from './feature-gates';
import { SpreadsheetAppPublicError, toPublicError } from './public-error';
import { RUNTIME_POLICY_SNAPSHOT_CAPABILITIES } from './runtime-policy-capabilities';
import type {
  SpreadsheetActorRef,
  SpreadsheetActorSession,
  SpreadsheetAppError,
  SpreadsheetAppEvent,
  SpreadsheetAttachmentState,
  SpreadsheetAuthorizationResult,
  SpreadsheetCapability,
  SpreadsheetCapabilityContext,
  SpreadsheetCommandResult,
  SpreadsheetCommandRequest,
  SpreadsheetDecorationHandle,
  SpreadsheetDirtyState,
  SpreadsheetDocumentSource,
  SpreadsheetMarkSavedInput,
  SpreadsheetOpenWorkbookRequest,
  SpreadsheetPolicyDecision,
  SpreadsheetPolicySnapshot,
  SpreadsheetResolvedActor,
  SpreadsheetRuntime,
  SpreadsheetRuntimeAssetPolicy,
  SpreadsheetRuntimeOptions,
  SpreadsheetSaveRequest,
  SpreadsheetSaveResult,
  SpreadsheetScreenshotOptions,
  SpreadsheetWorkbookFacade,
  SpreadsheetWorkbookSession,
  SpreadsheetWorkbookStatus,
} from './public-types';
import { loadDocumentForSource, materializeSpreadsheetWorkbook } from './shell-documents';
import type {
  RegisteredSpreadsheetAppBridge,
  SpreadsheetAppDocumentHandle,
  SpreadsheetAppWorkbook,
  WorkbookRecord,
} from './runtime-types';
import {
  actorRefFromInput,
  assertRecordUsable,
  createEvent,
  createWorkbookFacade,
  defaultAllowedAuthorization,
  implicitHostActor,
  isActorSession,
  policyDecision,
  type FacadeBinding,
} from './workbook-facade';

type ShellRuntimeAssetConfig = ShellBootstrapConfig & {
  readonly runtimeAssets?: {
    readonly wasmBaseUrl?: string;
    readonly workerUrl?: string;
    readonly staticAssetBase?: string;
  };
};

type RuntimeWorkbookRecord = WorkbookRecord & {
  readonly appKernel: IAppKernelAPI;
  readonly displayName: string;
  readonly documentVersioning: SpreadsheetRuntimeDocumentVersioningReadiness;
  attachmentState: SpreadsheetAttachmentState;
  readonly attachmentListeners: Set<(state: SpreadsheetAttachmentState) => void>;
};

type RuntimeControllerState = 'ready' | 'disposing' | 'disposed';

export type SpreadsheetRuntimeInternals = {
  readonly shell: Awaited<ReturnType<typeof createShell>>;
  readonly capabilityRegistry: Awaited<ReturnType<typeof createShell>>['capabilityRegistry'];
  readonly sessionId: string;
  getRecord(workbookSessionId: string): RuntimeWorkbookRecord | null;
  getRecordForSession(session: SpreadsheetWorkbookSession): RuntimeWorkbookRecord | null;
};

const runtimeControllers = new WeakMap<SpreadsheetRuntime, SpreadsheetRuntimeController>();
const sessionRecords = new WeakMap<SpreadsheetWorkbookSession, RuntimeWorkbookRecord>();

function toShellConfig(options: SpreadsheetRuntimeOptions): ShellRuntimeAssetConfig {
  const assets = options.assets;
  return {
    runtimeAssets: assets
      ? {
          wasmBaseUrl: assets.wasmBaseUrl,
          workerUrl: assets.workerUrl,
          staticAssetBase: assets.staticBaseUrl ?? assets.fontBaseUrl,
        }
      : undefined,
    beforeUnloadPrompt: options.host?.beforeUnloadPrompt,
  };
}

function cloneOpenSource(source: SpreadsheetDocumentSource): SpreadsheetDocumentSource {
  if (source.kind === 'blank') return source;
  return { ...source, bytes: cloneBytes(source.bytes) };
}

function createRuntimeDisposedError(
  operation: string,
  runtimeId: string,
  workbookId?: string,
  epoch?: number,
): SpreadsheetAppPublicError {
  return toPublicError(new Error('Spreadsheet runtime is disposed'), 'Disposed', false, {
    runtimeId,
    workbookId,
    epoch,
    operation,
    staleHandleImpact: workbookId ? 'current-workbook' : 'all-workbooks',
  });
}

function createWorkbookAlreadyOpenError(workbookId: string): SpreadsheetAppPublicError {
  return toPublicError(
    new Error(`Workbook id "${workbookId}" is already open in this spreadsheet runtime`),
    'RuntimeError',
    false,
    {
      workbookId,
      operation: 'openWorkbook',
    },
  );
}

function createStaleActorError(
  record: RuntimeWorkbookRecord,
  operation: string,
  actor: SpreadsheetActorRef | undefined,
): SpreadsheetAppPublicError {
  return toPublicError(
    new Error('Actor session is not valid for this workbook epoch'),
    'StaleEpoch',
    false,
    {
      workbookId: record.workbookId,
      epoch: record.epoch,
      operation,
      actor,
      staleHandleImpact: 'current-workbook',
    },
  );
}

class RuntimeWorkbookSession implements SpreadsheetWorkbookSession {
  readonly ready: Promise<void>;

  constructor(
    private readonly controller: SpreadsheetRuntimeController,
    private readonly record: RuntimeWorkbookRecord,
  ) {
    this.ready = record.ready;
    sessionRecords.set(this, record);
  }

  get workbookId(): string {
    return this.record.workbookId;
  }

  get workbookSessionId(): string {
    return this.record.workbookSessionId;
  }

  get epoch(): number {
    return this.record.epoch;
  }

  getStatus(): SpreadsheetWorkbookStatus {
    return this.record.status;
  }

  getAttachmentState(): SpreadsheetAttachmentState {
    return this.record.attachmentState;
  }

  async whenReady(epoch?: number): Promise<void> {
    this.controller.assertRuntimeOpen('whenReady');
    if (epoch !== undefined && epoch !== this.record.epoch) {
      throw toPublicError(new Error('Requested workbook epoch is stale'), 'StaleEpoch', false, {
        workbookId: this.record.workbookId,
        epoch: this.record.epoch,
        operation: 'whenReady',
        staleHandleImpact: 'current-workbook',
      });
    }
    assertRecordUsable(this.record, 'whenReady');
    await this.record.ready;
  }

  resolveActor(actor: SpreadsheetActorRef): Promise<SpreadsheetActorSession> {
    return this.controller.createActorSession(actor, this.record);
  }

  getWorkbook(): SpreadsheetWorkbookFacade {
    this.controller.assertRuntimeOpen('getWorkbook');
    assertRecordUsable(this.record, 'getWorkbook');
    return this.record.facade;
  }

  exportXlsx(actor?: SpreadsheetActorRef | SpreadsheetActorSession): Promise<Uint8Array> {
    return this.controller.exportXlsxForRecord(this.record, actor);
  }

  requestSave(
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<SpreadsheetSaveResult> {
    return this.controller.requestSaveForRecord(this.record, actor);
  }

  markSaved(input: SpreadsheetMarkSavedInput): void {
    this.controller.markSavedForRecord(this.record, input);
  }

  captureScreenshot(
    actor: SpreadsheetActorRef | SpreadsheetActorSession,
    sheet: string,
    range: string,
    options?: SpreadsheetScreenshotOptions,
  ): Promise<Uint8Array> {
    return this.controller.captureScreenshotForRecord(this.record, actor, sheet, range, options);
  }

  undoGroup<T>(
    actor: SpreadsheetActorRef | SpreadsheetActorSession,
    label: string,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    return this.controller.undoGroupForRecord(this.record, actor, label, fn);
  }

  decorations(
    actor: SpreadsheetActorRef | SpreadsheetActorSession,
  ): SpreadsheetDecorationHandle | null {
    return this.controller.decorationsForRecord(this.record, actor);
  }

  getEffectivePolicySnapshot(
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<SpreadsheetPolicySnapshot> {
    return this.controller.policySnapshot(actor, this.record);
  }

  onDirtyChange(handler: (state: SpreadsheetDirtyState) => void): () => void {
    this.record.dirtyListeners.add(handler);
    return () => this.record.dirtyListeners.delete(handler);
  }

  onSaveStateChange(
    handler: (state: import('./public-types').SpreadsheetSaveState) => void,
  ): () => void {
    this.record.saveListeners.add(handler);
    return () => this.record.saveListeners.delete(handler);
  }

  onAttachmentChange(handler: (state: SpreadsheetAttachmentState) => void): () => void {
    this.record.attachmentListeners.add(handler);
    return () => this.record.attachmentListeners.delete(handler);
  }

  onDisposed(handler: () => void): () => void {
    this.record.disposedListeners.add(handler);
    return () => this.record.disposedListeners.delete(handler);
  }

  dispose(): Promise<void> {
    return this.controller.disposeWorkbookRecord(this.record);
  }
}

class SpreadsheetRuntimeController
  implements SpreadsheetRuntime, SpreadsheetRuntimeWithAttachmentController
{
  readonly ready = Promise.resolve();
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly capabilityRegistry: Awaited<ReturnType<typeof createShell>>['capabilityRegistry'];
  readonly [SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER]: SpreadsheetRuntimeAttachmentController = {
    attach: (request) => this.attachWorkbookSession(request),
  };

  private state: RuntimeControllerState = 'ready';
  private readonly records = new Map<string, RuntimeWorkbookRecord>();
  private readonly sessions = new Map<string, RuntimeWorkbookSession>();
  private readonly openingWorkbooks = new Map<string, Promise<SpreadsheetWorkbookSession>>();
  private readonly workbookEpochs = new Map<string, number>();
  private readonly eventListeners = new Set<(event: SpreadsheetAppEvent) => void>();
  private readonly disposedListeners = new Set<() => void>();
  private disposePromise: Promise<void> | null = null;

  constructor(
    readonly shell: Awaited<ReturnType<typeof createShell>>,
    private readonly options: SpreadsheetRuntimeOptions,
  ) {
    this.capabilityRegistry = shell.capabilityRegistry;
    this.runtimeId = options.runtimeId ?? createRuntimeId('spreadsheet-runtime');
    this.sessionId = createRuntimeId('spreadsheet-session');
  }

  assertRuntimeOpen(operation: string): void {
    if (this.state !== 'ready') {
      throw createRuntimeDisposedError(operation, this.runtimeId);
    }
  }

  async openWorkbook(input: SpreadsheetOpenWorkbookRequest): Promise<SpreadsheetWorkbookSession> {
    this.assertRuntimeOpen('openWorkbook');

    const workbookSessionId = input.workbookSessionId ?? createRuntimeId('workbook-session');
    const existing = this.records.get(workbookSessionId);
    if (existing && existing.status !== 'disposed') {
      throw createWorkbookAlreadyOpenError(workbookSessionId);
    }

    const inFlight = this.openingWorkbooks.get(workbookSessionId);
    if (inFlight) return inFlight;

    const opening = this.openWorkbookInternal(input, workbookSessionId);
    this.openingWorkbooks.set(workbookSessionId, opening);
    try {
      return await opening;
    } finally {
      if (this.openingWorkbooks.get(workbookSessionId) === opening) {
        this.openingWorkbooks.delete(workbookSessionId);
      }
    }
  }

  getWorkbookSession(workbookSessionId: string): SpreadsheetWorkbookSession | null {
    const record = this.records.get(workbookSessionId);
    if (record && record.status !== 'disposed') {
      return this.sessions.get(workbookSessionId) ?? null;
    }
    return this.getWorkbookSessionByWorkbookId(workbookSessionId);
  }

  getWorkbookSessionByWorkbookId(workbookId: string): SpreadsheetWorkbookSession | null {
    const matches = [...this.records.values()].filter(
      (record) => record.workbookId === workbookId && record.status !== 'disposed',
    );
    if (matches.length !== 1) return null;
    return this.sessions.get(matches[0].workbookSessionId) ?? null;
  }

  listWorkbookSessions(): readonly SpreadsheetWorkbookSession[] {
    return [...this.sessions.values()].filter((session) => session.getStatus() !== 'disposed');
  }

  onEvent(handler: (event: SpreadsheetAppEvent) => void): () => void {
    if (this.state === 'disposed') return noopDisposable();
    this.eventListeners.add(handler);
    return () => this.eventListeners.delete(handler);
  }

  onDisposed(handler: () => void): () => void {
    if (this.state === 'disposed') {
      handler();
      return noopDisposable();
    }
    this.disposedListeners.add(handler);
    return () => this.disposedListeners.delete(handler);
  }

  async disposeWorkbook(workbookSessionId: string): Promise<void> {
    const record = this.records.get(workbookSessionId);
    if (!record) return;
    await this.disposeWorkbookRecord(record);
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.state = 'disposing';
    this.disposePromise = (async () => {
      const records = [...this.records.values()];
      for (const record of records) {
        this.markRecordDisposed(record);
      }
      this.records.clear();
      this.sessions.clear();

      const pendingOpens = Promise.allSettled([...this.openingWorkbooks.values()]);
      const shellDispose = this.shell.dispose();
      const failures: unknown[] = [];

      const [openResults, shellResult] = await Promise.allSettled([pendingOpens, shellDispose]);
      if (openResults.status === 'fulfilled') {
        for (const result of openResults.value) {
          if (result.status === 'rejected' && !this.isExpectedDisposalRejection(result.reason)) {
            failures.push(result.reason);
          }
        }
      } else if (!this.isExpectedDisposalRejection(openResults.reason)) {
        failures.push(openResults.reason);
      }
      if (shellResult.status === 'rejected') {
        failures.push(shellResult.reason);
      }

      this.capabilityRegistry.dispose?.();
      this.state = 'disposed';
      for (const listener of this.disposedListeners) listener();
      this.disposedListeners.clear();
      this.eventListeners.clear();
      this.openingWorkbooks.clear();

      if (failures.length > 0) {
        throw new AggregateError(failures, '[SpreadsheetRuntime] dispose failed');
      }
    })();
    return this.disposePromise;
  }

  getInternals(): SpreadsheetRuntimeInternals {
    return {
      shell: this.shell,
      capabilityRegistry: this.capabilityRegistry,
      sessionId: this.sessionId,
      getRecord: (workbookSessionId) => this.records.get(workbookSessionId) ?? null,
      getRecordForSession: (session) => sessionRecords.get(session) ?? null,
    };
  }

  async attachWorkbookSession(
    request: SpreadsheetRuntimeAttachRequest,
  ): Promise<SpreadsheetRuntimeAttachmentEnvironment> {
    this.assertRuntimeOpen('attach');

    const record = sessionRecords.get(request.workbook);
    if (!record || this.records.get(record.workbookSessionId) !== record) {
      throw toPublicError(
        new Error('Workbook session does not belong to this spreadsheet runtime'),
        'StaleEpoch',
        false,
        {
          runtimeId: this.runtimeId,
          attachmentId: request.attachmentId,
          workbookId: request.workbook.workbookId,
          epoch: request.workbook.epoch,
          operation: 'attach',
          staleHandleImpact: 'current-workbook',
        },
      );
    }
    assertRecordUsable(record, 'attach');

    if (
      (record.attachmentState.status === 'attaching' ||
        record.attachmentState.status === 'attached' ||
        record.attachmentState.status === 'detaching') &&
      record.attachmentState.attachmentId !== request.attachmentId
    ) {
      throw toPublicError(
        new Error(`Workbook "${record.workbookId}" already has a full-app UI attachment`),
        'AlreadyAttached',
        false,
        {
          runtimeId: this.runtimeId,
          attachmentId: request.attachmentId,
          workbookId: record.workbookId,
          epoch: record.epoch,
          operation: 'attach',
        },
      );
    }

    this.setAttachmentState(record, {
      status: 'attaching',
      workbookId: record.workbookId,
      epoch: record.epoch,
      attachmentId: request.attachmentId,
    });
    this.activateWorkbookForShell(record);
    this.setAttachmentState(record, {
      status: 'attached',
      workbookId: record.workbookId,
      epoch: record.epoch,
      attachmentId: request.attachmentId,
    });

    let detached = false;
    let unregisterBridge: (() => void) | null = null;

    const detach = async (): Promise<void> => {
      if (detached) return;
      detached = true;
      unregisterBridge?.();
      unregisterBridge = null;

      if (
        record.status !== 'disposed' &&
        (record.attachmentState.status === 'attached' ||
          record.attachmentState.status === 'attaching' ||
          record.attachmentState.status === 'detaching') &&
        record.attachmentState.attachmentId === request.attachmentId
      ) {
        this.setAttachmentState(record, {
          status: 'detaching',
          workbookId: record.workbookId,
          epoch: record.epoch,
          attachmentId: request.attachmentId,
        });
        this.setAttachmentState(record, {
          status: 'headless',
          workbookId: record.workbookId,
          epoch: record.epoch,
        });
      }
    };

    return {
      attachmentId: request.attachmentId,
      workbookId: record.workbookId,
      workbook: request.workbook,
      documentId: record.documentId,
      documentVersioning: record.documentVersioning,
      shell: this.shell,
      appKernel: record.appKernel,
      capabilityRegistry: this.capabilityRegistry,
      hostCommands: {
        getOwner: (command) =>
          resolveCommandOwner(
            {
              commands: request.props.commands,
              host: this.options.host,
              onSaveRequest: this.options.onSaveRequest,
              onCommandRequest: this.options.onCommandRequest,
            },
            command,
          ),
        request: (commandRequest) => this.requestCommandForRecord(record, commandRequest),
      },
      getStatus: () => (record.status === 'disposed' ? 'disposed' : 'ready'),
      registerAppBridge: (bridge) => {
        if (bridge.documentId !== record.documentId && bridge.documentId !== record.workbookId) {
          throw toPublicError(
            new Error('Spreadsheet app bridge registered for the wrong workbook'),
            'AttachFailed',
            false,
            {
              runtimeId: this.runtimeId,
              attachmentId: request.attachmentId,
              workbookId: record.workbookId,
              epoch: record.epoch,
              operation: 'registerAppBridge',
            },
          );
        }
        unregisterBridge?.();
        unregisterBridge = this.registerAppBridge(record, bridge);
        return () => {
          unregisterBridge?.();
          unregisterBridge = null;
        };
      },
      detach,
    };
  }

  async createActorSession(
    actorRef: SpreadsheetActorRef,
    record: RuntimeWorkbookRecord,
  ): Promise<SpreadsheetActorSession> {
    const actor = await this.resolveActor(actorRef, record);
    await this.authorize(actorRef, record, 'workbook:read', 'resolveActor');
    const policy = await this.policySnapshot(actorRef, record);
    const brand: ActorSessionBrand = {
      sessionId: this.sessionId,
      workbookSessionId: record.workbookSessionId,
      workbookId: record.workbookId,
      epoch: record.epoch,
      policyVersion: policy.decisions
        .map((decision) => `${decision.capability}:${decision.decision}`)
        .join('|'),
    };
    const binding: FacadeBinding = { actor, policy, brand };
    const session: InternalSpreadsheetActorSession = {
      [SPREADSHEET_ACTOR_SESSION_BRAND]: brand,
      actor,
      policy,
      workbookId: record.workbookId,
      epoch: record.epoch,
      getWorkbook: () => createWorkbookFacade(record, binding),
      requestSave: () => this.requestSaveForRecord(record, session),
      exportXlsx: () => this.exportXlsxForRecord(record, session),
      captureScreenshot: (sheet, range, options) =>
        this.captureScreenshotForRecord(record, session, sheet, range, options),
      undoGroup: (label, fn) => this.undoGroupForRecord(record, session, label, fn),
      decorations: () => this.decorationsForRecord(record, session),
      getEffectivePolicySnapshot: () => this.policySnapshot(session, record),
    };
    return session;
  }

  async exportXlsxForRecord(
    record: RuntimeWorkbookRecord,
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<Uint8Array> {
    await this.authorize(actor, record, 'workbook:export', 'exportXlsx');
    try {
      const bytes = new Uint8Array(await record.workbook.toXlsx());
      return bytes;
    } catch (exportError) {
      throw toPublicError(exportError, 'ExportFailed', true, {
        workbookId: record.workbookId,
        epoch: record.epoch,
        operation: 'exportXlsx',
      });
    }
  }

  async requestCommandForRecord(
    record: RuntimeWorkbookRecord,
    input: SpreadsheetAttachmentCommandRequest,
  ): Promise<SpreadsheetAttachmentCommandResult> {
    const owner = resolveCommandOwner(
      {
        commands: undefined,
        host: this.options.host,
        onSaveRequest: this.options.onSaveRequest,
        onCommandRequest: this.options.onCommandRequest,
      },
      input.command,
    );
    if (owner === 'disabled') {
      return { status: 'denied', reason: `${input.command} is disabled by host policy` };
    }
    if (owner === 'mog') {
      return { status: 'not-handled' };
    }

    const baseRequest: Omit<SpreadsheetCommandRequest, 'command'> = {
      workbookId: record.workbookId,
      epoch: record.epoch,
      format: input.format === 'json' ? undefined : input.format,
    };

    try {
      if (input.command === 'save') {
        const save = await this.startSaveRequestForRecord(record);
        const commandResult = await this.options.onCommandRequest?.({
          command: 'save',
          ...baseRequest,
          save,
        });
        if (!commandResult && this.options.onSaveRequest) {
          const saveResult = await this.options.onSaveRequest(save);
          if (saveResult) this.applyExplicitSaveResult(record, saveResult);
          return { status: 'handled', result: saveResult };
        }
        if (!commandResult || commandResult.status === 'not-handled') {
          this.applyFailedSaveResult(
            record,
            save,
            toPublicError(new Error('Host did not handle save command'), 'SaveFailed', true),
          );
          return { status: 'not-handled' };
        }
        if (commandResult.status === 'denied') {
          this.applyFailedSaveResult(
            record,
            save,
            toPublicError(new Error(commandResult.reason), 'AuthorizationDenied', false),
          );
          return { status: 'denied', reason: commandResult.reason };
        }
        const handledCommandResult = commandResult as Extract<
          SpreadsheetCommandResult,
          { status: 'handled' }
        >;
        const saveResult = handledCommandResult.result as unknown;
        if (saveResult && typeof saveResult === 'object' && 'status' in saveResult) {
          this.applyExplicitSaveResult(record, saveResult as SpreadsheetSaveResult);
        }
        return { status: 'handled', result: handledCommandResult.result };
      }

      let exportPayload: SpreadsheetCommandRequest['export'] | undefined;
      if (input.command === 'export' && input.format === 'xlsx') {
        const bytes = await this.exportXlsxForRecord(record);
        exportPayload = {
          workbookId: record.workbookId,
          epoch: record.epoch,
          format: 'xlsx',
          bytes,
          bytesHash: await hashBytes(bytes),
        };
      }

      const commandResult = await this.options.onCommandRequest?.({
        command: input.command,
        ...baseRequest,
        export: exportPayload,
      });
      if (!commandResult) return { status: 'not-handled' };
      if (commandResult.status === 'handled') {
        return { status: 'handled', result: commandResult.result };
      }
      if (commandResult.status === 'denied') {
        return { status: 'denied', reason: commandResult.reason };
      }
      return { status: 'not-handled' };
    } catch (commandError) {
      return {
        status: 'denied',
        reason: commandError instanceof Error ? commandError.message : String(commandError),
      };
    }
  }

  async requestSaveForRecord(
    record: RuntimeWorkbookRecord,
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<SpreadsheetSaveResult> {
    const request = await this.startSaveRequestForRecord(record, actor);
    try {
      const result = await this.options.onSaveRequest?.(request);
      if (!result) {
        return this.applyFailedSaveResult(
          record,
          request,
          toPublicError(new Error('No onSaveRequest handler is registered'), 'SaveFailed', true),
        );
      }
      this.applyExplicitSaveResult(record, result);
      return result;
    } catch (saveError) {
      record.pendingSaves.delete(request.saveRequestId);
      if (saveError instanceof SpreadsheetAppPublicError && saveError.kind === 'StaleEpoch') {
        const staleResult: SpreadsheetSaveResult = {
          status: 'stale',
          workbookId: request.workbookId,
          epoch: request.epoch,
          dirtyEpoch: request.dirtyEpoch,
          changeSequence: request.changeSequence,
          saveRequestId: request.saveRequestId,
          bytesHash: request.bytesHash,
          error: saveError,
        };
        this.emitSaveState(record);
        return staleResult;
      }
      const errorResult: SpreadsheetSaveResult = {
        status: 'failed',
        workbookId: request.workbookId,
        epoch: request.epoch,
        dirtyEpoch: request.dirtyEpoch,
        changeSequence: request.changeSequence,
        saveRequestId: request.saveRequestId,
        bytesHash: request.bytesHash,
        error: toPublicError(saveError, 'SaveFailed', true, {
          workbookId: record.workbookId,
          epoch: record.epoch,
          operation: 'requestSave',
        }),
      };
      record.saveState = {
        status: 'error',
        workbookId: record.workbookId,
        epoch: record.epoch,
        dirtyEpoch: request.dirtyEpoch,
        changeSequence: request.changeSequence,
        error: errorResult.error,
      };
      this.emitSaveState(record);
      return errorResult;
    }
  }

  markSavedForRecord(record: RuntimeWorkbookRecord, input: SpreadsheetMarkSavedInput): void {
    this.assertRuntimeOpen('markSaved');
    assertRecordUsable(record, 'markSaved');
    if (input.epoch !== record.epoch) {
      throw toPublicError(
        new Error('Save acknowledgement targets a stale workbook'),
        'StaleEpoch',
        false,
        {
          workbookId: record.workbookId,
          epoch: record.epoch,
          operation: 'markSaved',
        },
      );
    }
    const pending = record.pendingSaves.get(input.saveRequestId);
    if (!pending) {
      throw toPublicError(
        new Error('Save acknowledgement does not match a pending save request'),
        'SaveFailed',
        false,
        {
          workbookId: record.workbookId,
          epoch: record.epoch,
          operation: 'markSaved',
        },
      );
    }
    if (
      pending.dirtyEpoch !== input.dirtyEpoch ||
      pending.changeSequence !== input.changeSequence ||
      pending.bytesHash !== input.bytesHash
    ) {
      throw toPublicError(
        new Error('Save acknowledgement does not match the pending save request'),
        'SaveFailed',
        false,
        {
          workbookId: record.workbookId,
          epoch: record.epoch,
          operation: 'markSaved',
        },
      );
    }
    const currentDirtyEpoch = record.dirtyEpoch ?? pending.dirtyEpoch;
    if (
      record.changeSequence !== pending.changeSequence ||
      currentDirtyEpoch !== pending.dirtyEpoch
    ) {
      record.pendingSaves.delete(input.saveRequestId);
      throw toPublicError(
        new Error('Save acknowledgement is stale because newer edits exist'),
        'StaleEpoch',
        true,
        {
          workbookId: record.workbookId,
          epoch: record.epoch,
          operation: 'markSaved',
        },
      );
    }
    record.pendingSaves.delete(input.saveRequestId);
    record.workbook.markClean();
    record.versionId = input.versionId;
    record.dirtyEpoch = null;
    record.saveState = makeCleanState(record.workbookId, record.epoch, input.versionId);
    const dirtyState: SpreadsheetDirtyState = {
      status: 'clean',
      workbookId: record.workbookId,
      epoch: record.epoch,
      changeSequence: record.changeSequence,
      versionId: input.versionId,
    };
    record.dirtyListeners.forEach((listener) => listener(dirtyState));
    this.emitRecordEvent(
      record,
      createEvent(record, 'dirty-change', dirtyState, record.changeSequence),
    );
    this.emitSaveState(record);
  }

  async captureScreenshotForRecord(
    record: RuntimeWorkbookRecord,
    actor: SpreadsheetActorRef | SpreadsheetActorSession | undefined,
    sheet: string,
    range: string,
    options?: SpreadsheetScreenshotOptions,
  ): Promise<Uint8Array> {
    await this.authorize(actor, record, 'workbook:screenshot', 'captureScreenshot');
    return new Uint8Array(await record.workbook.captureScreenshot(sheet, range, options));
  }

  async undoGroupForRecord<T>(
    record: RuntimeWorkbookRecord,
    actor: SpreadsheetActorRef | SpreadsheetActorSession | undefined,
    label: string,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    await this.authorize(actor, record, 'workbook:undo-group', 'undoGroup');
    const workbookWithBatch = record.workbook as SpreadsheetAppWorkbook & {
      batch?: <R>(label: string, fn: () => Promise<R> | R) => Promise<R>;
    };
    if (typeof workbookWithBatch.batch === 'function') {
      return workbookWithBatch.batch(label, async () => fn());
    }
    return record.workbook.undoGroup(async () => fn());
  }

  decorationsForRecord(
    record: RuntimeWorkbookRecord,
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): SpreadsheetDecorationHandle | null {
    this.assertRuntimeOpen('decorations');
    assertRecordUsable(record, 'decorations');
    if (actor && !isActorSession(actor)) return null;
    if (isActorSession(actor) && policyDecision(actor.policy, 'decorations:write') !== 'allowed') {
      return null;
    }
    return record.decorations;
  }

  async policySnapshot(
    actorInput: SpreadsheetActorRef | SpreadsheetActorSession | undefined,
    record: RuntimeWorkbookRecord,
  ): Promise<SpreadsheetPolicySnapshot> {
    const actor = isActorSession(actorInput)
      ? actorInput.actor
      : await this.resolveActor(
          actorRefFromInput(actorInput),
          record,
          'getEffectivePolicySnapshot',
        );
    const decisions: Array<{
      capability: SpreadsheetCapability;
      decision: SpreadsheetPolicyDecision;
    }> = [];
    for (const capability of RUNTIME_POLICY_SNAPSHOT_CAPABILITIES) {
      try {
        await this.authorize(actorInput, record, capability, `policy.${capability}`);
        decisions.push({ capability, decision: 'allowed' });
      } catch {
        decisions.push({ capability, decision: 'denied' });
      }
    }
    return { actor, workbookId: record.workbookId, epoch: record.epoch, decisions };
  }

  async disposeWorkbookRecord(record: RuntimeWorkbookRecord): Promise<void> {
    if (record.status === 'disposed') return;
    this.markRecordDisposed(record);
    this.records.delete(record.workbookSessionId);
    this.sessions.delete(record.workbookSessionId);
    await this.shell.documentManager.disposeDocument(record.documentId);
  }

  private async openWorkbookInternal(
    input: SpreadsheetOpenWorkbookRequest,
    workbookSessionId: string,
  ): Promise<SpreadsheetWorkbookSession> {
    const source = cloneOpenSource(input.source);
    const skipLocalPersistence = this.options.host?.persistenceMode === 'host-owned-ephemeral';
    const documentId = workbookSessionId;
    const loaded = await loadDocumentForSource(this.shell, documentId, source, {
      skipLocalPersistence,
    });

    if (this.state !== 'ready') {
      try {
        await this.shell.documentManager.disposeDocument(documentId);
      } catch {
        await loaded.handle.dispose();
      }
      throw createRuntimeDisposedError('openWorkbook', this.runtimeId, input.workbookId);
    }

    const record = await this.createRecord(
      loaded.handle,
      workbookSessionId,
      documentId,
      input.workbookId,
      this.nextEpochFor(workbookSessionId),
      input.displayName ??
        (source.kind === 'xlsx-bytes' ? source.fileName : undefined) ??
        'Embedded Mog workbook',
      loaded.documentVersioning,
      source.kind === 'xlsx-bytes' ? source.versionId : undefined,
    );
    this.records.set(workbookSessionId, record);
    const session = new RuntimeWorkbookSession(this, record);
    this.sessions.set(workbookSessionId, session);
    return session;
  }

  private async createRecord(
    handle: SpreadsheetAppDocumentHandle,
    workbookSessionId: string,
    documentId: string,
    workbookId: string,
    epoch: number,
    displayName: string,
    documentVersioning: SpreadsheetRuntimeDocumentVersioningReadiness,
    versionId?: string,
  ): Promise<RuntimeWorkbookRecord> {
    const { workbook, documentVersioning: resolvedDocumentVersioning } =
      await materializeSpreadsheetWorkbook(handle, documentVersioning);
    workbook.markClean();
    const record: RuntimeWorkbookRecord = {
      workbookSessionId,
      documentId,
      workbookId,
      epoch,
      displayName,
      documentVersioning: resolvedDocumentVersioning,
      foreground: false,
      handle,
      workbook,
      appKernel: createAppKernelAPIFromHandle(handle as DocumentHandle, workbook),
      facade: null as unknown as SpreadsheetWorkbookFacade,
      status: 'ready',
      saveState: makeCleanState(workbookId, epoch, versionId),
      pendingSaves: new Map(),
      changeSequence: 0,
      dirtyEpoch: null,
      versionId,
      ready: Promise.resolve(),
      decorations: new InternalDecorationHandle(() => {
        this.emitRecordEvent(
          record,
          createEvent(
            record,
            'decoration-change',
            {
              workbookId: record.workbookId,
              epoch: record.epoch,
              decorations: record.decorations.list().map((decoration) => ({
                id: decoration.id ?? '',
                sheet: decoration.sheet,
                range: decoration.range,
              })),
            },
            record.changeSequence,
          ),
        );
      }),
      dirtyListeners: new Set(),
      saveListeners: new Set(),
      disposedListeners: new Set(),
      attachmentState: { status: 'headless', workbookId, epoch },
      attachmentListeners: new Set(),
    };
    record.facade = createWorkbookFacade(record);
    record.unsubscribeEvents = handle.eventBus.onAll((event: unknown) => {
      if (
        shouldTrackWorkbookDirtyEvent(event, {
          workbookAlreadyDirty: record.dirtyEpoch !== null,
          importDurabilityPending: handle.isImportDurabilityPending === true,
        })
      ) {
        this.markRecordDirty(record);
      }
    });
    return record;
  }

  private markRecordDirty(record: RuntimeWorkbookRecord): void {
    if (record.status === 'disposed' || record.status === 'stale') return;
    record.changeSequence += 1;
    if (record.dirtyEpoch === null) {
      record.dirtyEpoch = record.epoch;
    }
    const dirtyState: SpreadsheetDirtyState = {
      status: 'dirty',
      workbookId: record.workbookId,
      epoch: record.epoch,
      dirtyEpoch: record.dirtyEpoch,
      changeSequence: record.changeSequence,
      baseVersionId: record.versionId,
    };
    record.saveState = dirtyState;
    record.dirtyListeners.forEach((listener) => listener(dirtyState));
    this.emitRecordEvent(
      record,
      createEvent(record, 'dirty-change', dirtyState, record.changeSequence),
    );
    this.emitSaveState(record);
  }

  private markRecordDisposed(record: RuntimeWorkbookRecord): void {
    if (record.status === 'disposed') return;
    record.status = 'disposed';
    record.attachmentState = {
      status: 'disposed',
      workbookId: record.workbookId,
      epoch: record.epoch,
    };
    record.unsubscribeEvents?.();
    record.unsubscribeAppBridge?.();
    record.attachmentListeners.forEach((listener) => listener(record.attachmentState));
    record.disposedListeners.forEach((listener) => listener());
    this.emitRecordEvent(
      record,
      createEvent(
        record,
        'disposed',
        { workbookId: record.workbookId, epoch: record.epoch },
        record.changeSequence,
      ),
    );
  }

  private activateWorkbookForShell(record: RuntimeWorkbookRecord): void {
    const store = this.shell.store.getState();
    if (!store.openFileIds.includes(record.documentId)) {
      store.addOpenFileId(record.documentId);
    }
    if (!store.files[record.documentId]) {
      store.addFile({
        id: record.documentId,
        filePath: null,
        displayName: record.displayName,
        isModified: false,
        lastSaved: null,
        documentType: 'spreadsheet',
      });
    }
    store.setActiveFileId(record.documentId);
    store.setActiveAppId('spreadsheet');
  }

  private nextEpochFor(workbookId: string): number {
    const epoch = (this.workbookEpochs.get(workbookId) ?? 0) + 1;
    this.workbookEpochs.set(workbookId, epoch);
    return epoch;
  }

  private registerAppBridge(
    record: RuntimeWorkbookRecord,
    bridge: RegisteredSpreadsheetAppBridge,
  ): () => void {
    record.unsubscribeAppBridge?.();

    const emitSelection = (
      snapshot: ReturnType<RegisteredSpreadsheetAppBridge['getSelection']>,
    ) => {
      this.emitRecordEvent(
        record,
        createEvent(
          record,
          'selection-change',
          { workbookId: record.workbookId, epoch: record.epoch, ...snapshot },
          record.changeSequence,
        ),
      );
    };
    const emitActiveSheet = (
      snapshot: ReturnType<RegisteredSpreadsheetAppBridge['getActiveSheet']>,
    ) => {
      this.emitRecordEvent(
        record,
        createEvent(
          record,
          'active-sheet-change',
          { workbookId: record.workbookId, epoch: record.epoch, ...snapshot },
          record.changeSequence,
        ),
      );
    };

    const unsubscribeSelection = bridge.onSelectionChange(emitSelection);
    const unsubscribeActiveSheet = bridge.onActiveSheetChange(emitActiveSheet);
    const cleanup = () => {
      unsubscribeSelection();
      unsubscribeActiveSheet();
      if (record.unsubscribeAppBridge === cleanup) {
        record.unsubscribeAppBridge = undefined;
      }
    };
    record.unsubscribeAppBridge = cleanup;
    emitSelection(bridge.getSelection());
    emitActiveSheet(bridge.getActiveSheet());
    return cleanup;
  }

  private setAttachmentState(
    record: RuntimeWorkbookRecord,
    state: SpreadsheetAttachmentState,
  ): void {
    record.attachmentState = state;
    record.attachmentListeners.forEach((listener) => listener(state));
  }

  private emitSaveState(record: RuntimeWorkbookRecord): void {
    record.saveListeners.forEach((listener) => listener(record.saveState));
    this.emitRecordEvent(
      record,
      createEvent(record, 'save-state-change', record.saveState, record.changeSequence),
    );
  }

  private emitRecordEvent(record: RuntimeWorkbookRecord, event: SpreadsheetAppEvent): void {
    if (record.status === 'disposed' && event.type !== 'disposed') return;
    this.options.onEvent?.(event);
    for (const listener of this.eventListeners) listener(event);
  }

  private buildCapabilityContext(
    record: RuntimeWorkbookRecord,
    operation: string,
  ): SpreadsheetCapabilityContext {
    return {
      sessionId: this.sessionId,
      workbookSessionId: record.workbookSessionId,
      workbookId: record.workbookId,
      epoch: record.epoch,
      attached:
        record.attachmentState.status === 'attached' ||
        record.attachmentState.status === 'attaching',
      operation,
    };
  }

  private async resolveActor(
    actorRef: SpreadsheetActorRef | undefined,
    record: RuntimeWorkbookRecord,
    operation = 'resolveActor',
  ): Promise<SpreadsheetResolvedActor> {
    if (!actorRef) return implicitHostActor();

    const authority = this.options.host?.authority;
    const context = this.buildCapabilityContext(record, operation);
    if (authority) {
      return authority.resolveActor(actorRef, context);
    }

    const kind = actorRef.kind ?? 'user';
    if (kind === 'agent' || kind === 'automation' || kind === 'system' || kind === 'host') {
      throw toPublicError(
        new Error(`Actor kind "${kind}" requires a host authority adapter`),
        'AuthorizationDenied',
        false,
        { workbookId: record.workbookId, epoch: record.epoch, operation },
      );
    }
    return { actorId: actorRef.actorId, kind, displayName: actorRef.displayName };
  }

  private async authorize(
    actorInput: SpreadsheetActorRef | SpreadsheetActorSession | undefined,
    record: RuntimeWorkbookRecord,
    capability: SpreadsheetCapability,
    operation: string,
  ): Promise<SpreadsheetAuthorizationResult> {
    this.assertRuntimeOpen(operation);
    assertRecordUsable(record, operation);

    if (isActorSession(actorInput)) {
      const brand = actorInput[SPREADSHEET_ACTOR_SESSION_BRAND];
      if (
        brand.sessionId !== this.sessionId ||
        brand.workbookSessionId !== record.workbookSessionId ||
        brand.workbookId !== record.workbookId ||
        brand.epoch !== record.epoch
      ) {
        throw createStaleActorError(record, operation, actorInput.actor);
      }
    }

    const actor = isActorSession(actorInput)
      ? actorInput.actor
      : await this.resolveActor(actorRefFromInput(actorInput), record, operation);
    const authority = this.options.host?.authority;
    if (!authority && (actor.kind === 'host' || actor.kind === 'user'))
      return defaultAllowedAuthorization();
    if (!authority) {
      const reason = `Capability "${capability}" requires a host authority adapter`;
      throw toPublicError(new Error(reason), 'AuthorizationDenied', false, {
        workbookId: record.workbookId,
        epoch: record.epoch,
        operation,
      });
    }

    const result = await authority.authorize(
      actor,
      capability,
      this.buildCapabilityContext(record, operation),
    );
    if (result.decision === 'denied') {
      throw toPublicError(new Error(result.reason), 'AuthorizationDenied', false, {
        workbookId: record.workbookId,
        epoch: record.epoch,
        operation,
      });
    }
    if (result.decision === 'approval-required') {
      const approval = await this.options.onApprovalRequest?.(result.approvalRequest);
      if (!approval || approval.decision !== 'approved') {
        throw toPublicError(new Error('Operation requires approval'), 'ApprovalRequired', true, {
          workbookId: record.workbookId,
          epoch: record.epoch,
          operation,
          actor,
        });
      }
      return {
        decision: 'allowed',
        policyVersion: result.policyVersion,
        route: 'approval',
      };
    }
    return result;
  }

  private async startSaveRequestForRecord(
    record: RuntimeWorkbookRecord,
    actor?: SpreadsheetActorRef | SpreadsheetActorSession,
  ): Promise<SpreadsheetSaveRequest> {
    await this.authorize(actor, record, 'workbook:export', 'requestSave');
    const bytes = await this.exportXlsxForRecord(record, actor);
    const dirtyEpoch = record.dirtyEpoch ?? record.epoch;
    const request: SpreadsheetSaveRequest = {
      workbookId: record.workbookId,
      epoch: record.epoch,
      dirtyEpoch,
      changeSequence: record.changeSequence,
      saveRequestId: createRuntimeId('save'),
      baseVersionId: record.versionId,
      bytes,
      bytesHash: await hashBytes(bytes),
    };
    record.pendingSaves.set(request.saveRequestId, request);
    record.saveState = {
      status: 'saving',
      workbookId: request.workbookId,
      epoch: request.epoch,
      dirtyEpoch: request.dirtyEpoch,
      changeSequence: request.changeSequence,
      saveRequestId: request.saveRequestId,
      baseVersionId: request.baseVersionId,
      bytesHash: request.bytesHash,
      requestedAt: Date.now(),
    };
    this.emitSaveState(record);
    return request;
  }

  private applyFailedSaveResult(
    record: RuntimeWorkbookRecord,
    request: SpreadsheetSaveRequest,
    error: SpreadsheetAppError,
  ): SpreadsheetSaveResult {
    const result: SpreadsheetSaveResult = {
      status: 'failed',
      workbookId: request.workbookId,
      epoch: request.epoch,
      dirtyEpoch: request.dirtyEpoch,
      changeSequence: request.changeSequence,
      saveRequestId: request.saveRequestId,
      bytesHash: request.bytesHash,
      error,
    };
    record.pendingSaves.delete(request.saveRequestId);
    record.saveState = {
      status: 'error',
      workbookId: record.workbookId,
      epoch: record.epoch,
      dirtyEpoch: request.dirtyEpoch,
      changeSequence: request.changeSequence,
      error,
    };
    this.emitSaveState(record);
    return result;
  }

  private applyExplicitSaveResult(
    record: RuntimeWorkbookRecord,
    result: SpreadsheetSaveResult,
  ): void {
    if (result.status === 'saved') {
      this.markSavedForRecord(record, result);
      return;
    }
    record.pendingSaves.delete(result.saveRequestId);
    record.saveState = {
      status: 'error',
      workbookId: record.workbookId,
      epoch: record.epoch,
      dirtyEpoch: result.dirtyEpoch,
      changeSequence: result.changeSequence,
      error: result.error,
    };
    this.emitSaveState(record);
  }

  private isExpectedDisposalRejection(error: unknown): boolean {
    if (error instanceof SpreadsheetAppPublicError && error.kind === 'Disposed') return true;
    if (error instanceof Error && error.name === 'DocumentOpenAbortedError') return true;
    return error instanceof Error && /disposed|aborted/i.test(error.message);
  }
}

export async function createSpreadsheetRuntime(
  options: SpreadsheetRuntimeOptions,
): Promise<SpreadsheetRuntime> {
  const capabilityRegistry = createPermissiveShellCapabilityRegistry({ audit: false });
  let shell: Awaited<ReturnType<typeof createShell>>;
  try {
    shell = await createShell({ ...toShellConfig(options), capabilityRegistry });
  } catch (error) {
    capabilityRegistry.dispose();
    throw error;
  }
  await shell.eventDispatcher.start();
  const runtime = new SpreadsheetRuntimeController(shell, options);
  runtimeControllers.set(runtime, runtime);
  return runtime;
}

export function getSpreadsheetRuntimeInternals(
  runtime: SpreadsheetRuntime,
): SpreadsheetRuntimeInternals {
  const controller = runtimeControllers.get(runtime);
  if (!controller) {
    throw toPublicError(
      new Error('SpreadsheetRuntime was not created by createSpreadsheetRuntime'),
      'RuntimeError',
      false,
      {
        operation: 'getSpreadsheetRuntimeInternals',
      },
    );
  }
  return controller.getInternals();
}
