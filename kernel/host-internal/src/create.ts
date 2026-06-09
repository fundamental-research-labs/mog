/**
 * Host-backed document creation — the entry point for trusted adapters.
 *
 * Validates the host context via `prepareHostBackedDocument`, creates a
 * `DocumentLifecycleSystem` with `kind: 'host-backed'`, runs the lifecycle,
 * and returns a `DocumentHandle`.
 *
 * This module imports the narrow kernel-owned friend surface. The subpath is
 * workspace-private and stripped from public artifacts.
 */

import type { HostClock, KernelHostContext } from '@mog-sdk/types-host/kernel';
import type { HostKernelAdapterBindings } from '@mog-sdk/types-host/bindings';
import type { DocumentImportOptions, DocumentImportWarning } from '@mog-sdk/contracts/document';
import {
  DocumentLifecycleSystem,
  INTERNAL_INTERACTIVE_DEFERRED_IMPORT,
  _createDocumentHandleInternal,
  attachHostBootstrapCollaborationSidecar,
  documentImportWarningsFromDiagnostics,
  fetchRoomSnapshotForHostBootstrap,
  projectImportDiagnostic,
  validateAndResolveImportSource,
  type AuthorizedRoomBootstrap,
  type DocumentByteSyncPort,
  type DocumentHandle,
  type FlushableCollaborationSidecar,
  type InteractiveDeferredImportToken,
} from '@mog-sdk/kernel/host-lifecycle-internal';
import type { CheckpointResult, CloseResult } from '@mog-sdk/types-document/storage/lifecycle';
import { prepareHostBackedDocument } from './open';

type HeadlessWorkbookLinkResolver = {
  resolve(request: any): any;
};

type HeadlessWorkbookLinkScope = {
  readonly requestingDocumentId: string;
  readonly requestingSessionId: string;
  readonly actor: string;
  readonly principal: { readonly tags: readonly string[] };
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateHostBackedDocumentOptions {
  /** When true, the new document will not include a default empty sheet. */
  readonly skipDefaultSheet?: boolean;
}

export interface CreateHostBackedCollaborationDocumentOptions {
  readonly room: TrustedCollaborationRoomDescriptor;
  readonly timeouts?: {
    readonly snapshotMs?: number;
    readonly joinMs?: number;
    readonly finalFlushMs?: number;
  };
}

export interface TrustedCollaborationRoomDescriptor {
  readonly source: 'standalone-shell-trusted-room-link';
  readonly baseUrl: string;
  readonly roomId: string;
  readonly documentId: string;
  readonly participantId: string;
  readonly issuedAt: number;
}

export interface HostBackedCollaborationDocumentResult {
  readonly handle: DocumentHandle;
  readonly sidecar: FlushableCollaborationSidecar;
  readonly room: {
    readonly roomId: string;
    readonly roomUrl: string;
    readonly roomEpoch: number;
    readonly fullStateHash: string;
    readonly snapshotToken: string;
  };
}

export interface ImportHostBackedDocumentOptions {
  readonly importOptions?: DocumentImportOptions;
  readonly interactiveDeferredImportToken?: InteractiveDeferredImportToken;
}

export interface ImportHostBackedInteractiveDeferredDocumentOptions {
  readonly importOptions?: DocumentImportOptions;
}

export interface ImportHostBackedDocumentResult {
  readonly handle: DocumentHandle;
  readonly importWarnings: readonly DocumentImportWarning[];
}

export interface DocumentSyncCapableHandle extends DocumentHandle {
  createSyncPort(): DocumentByteSyncPort;
}

export interface CreateHeadlessDocumentOptions {
  readonly documentId: string;
  readonly napiAddon?: unknown;
  readonly userTimezone: string;
  readonly clock: HostClock;
  readonly initialSnapshot?: Record<string, unknown>;
  readonly yrsState?: Uint8Array;
  readonly workbookLinkResolver?: HeadlessWorkbookLinkResolver;
  readonly workbookLinkScope?: HeadlessWorkbookLinkScope;
}

export interface HeadlessDocumentImportOptions extends CreateHeadlessDocumentOptions {
  readonly importOptions?: DocumentImportOptions;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a new blank host-backed document.
 *
 * This is the canonical entry point for trusted host adapters that need to
 * create a real document through the host-backed lifecycle path.
 *
 * @param host - Validated host context (principal, storage, runtime, etc.)
 * @param bindings - Trusted adapter composition bindings
 * @param options - Optional creation parameters
 * @returns A fully initialized DocumentHandle
 */
export async function createHostBackedDocument(
  host: KernelHostContext,
  bindings: HostKernelAdapterBindings,
  options?: CreateHostBackedDocumentOptions,
): Promise<DocumentHandle> {
  const lifecycleInput = prepareHostBackedDocument(host, bindings);

  const lifecycle = new DocumentLifecycleSystem({
    kind: 'host-backed',
    lifecycleInput,
  });

  lifecycle.create(lifecycleInput.documentId, {
    skipDefaultSheet: options?.skipDefaultSheet,
  });
  await lifecycle.waitForReady();

  const context = lifecycle.documentContext;
  return _createDocumentHandleInternal(lifecycleInput.documentId, lifecycle, context);
}

export async function createHostBackedCollaborationDocument(
  host: KernelHostContext,
  bindings: HostKernelAdapterBindings,
  options: CreateHostBackedCollaborationDocumentOptions,
): Promise<HostBackedCollaborationDocumentResult> {
  const lifecycleInput = prepareHostBackedDocument(host, bindings);
  const { room } = options;
  if (room.documentId !== lifecycleInput.documentId) {
    throw new Error(
      `Collaboration documentId mismatch: room=${room.documentId}, host=${lifecycleInput.documentId}`,
    );
  }
  assertEphemeralCollaborationStorage(lifecycleInput.storage.handoff.storage);

  const roomUrl = canonicalizeRoomUrl(room.baseUrl, room.roomId);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let lifecycle: DocumentLifecycleSystem | null = null;
    let handle: DocumentHandle | null = null;
    let sidecar: FlushableCollaborationSidecar | null = null;
    try {
      const snapshot = await fetchRoomSnapshotForHostBootstrap(roomUrl, room.roomId, {
        timeoutMs: options.timeouts?.snapshotMs,
      });

      const authorizedRoomBootstrap: AuthorizedRoomBootstrap = {
        source: 'collaboration-room-snapshot',
        authority: {
          kind: 'trusted-standalone-collaboration-room',
          baseUrl: room.baseUrl,
        },
        roomId: room.roomId,
        roomUrl,
        documentId: room.documentId,
        participantId: room.participantId,
        fullState: snapshot.fullState,
        stateVector: snapshot.stateVector,
        roomEpoch: snapshot.roomEpoch,
        fullStateHash: snapshot.fullStateHash,
        snapshotToken: snapshot.snapshotToken,
        snapshotTokenVersion: snapshot.snapshotTokenVersion,
        fetchedAt: Date.now(),
      };

      lifecycle = new DocumentLifecycleSystem({
        kind: 'host-backed',
        lifecycleInput,
      });
      lifecycle.createHostBackedFromAuthorizedRoom(lifecycleInput.documentId, {
        skipDefaultSheet: true,
        authorizedRoomBootstrap,
      });
      await lifecycle.waitForReady();

      const context = lifecycle.documentContext;
      handle = _createDocumentHandleInternal(lifecycleInput.documentId, lifecycle, context);

      sidecar = await withTimeout(
        attachHostBootstrapCollaborationSidecar({
          url: roomUrl,
          roomId: room.roomId,
          participantId: room.participantId,
          computeBridge: lifecycle.computeBridge,
          preflightStateVector: snapshot.stateVector,
          preflightRoomEpoch: snapshot.roomEpoch,
          preflightFullStateHash: snapshot.fullStateHash,
          preflightSnapshotToken: snapshot.snapshotToken,
        }),
        options.timeouts?.joinMs ?? 10_000,
        'Timed out joining collaboration room',
      );

      return {
        handle: createRoomBackedHandle(handle, sidecar, options.timeouts?.finalFlushMs),
        sidecar,
        room: {
          roomId: room.roomId,
          roomUrl,
          roomEpoch: snapshot.roomEpoch,
          fullStateHash: snapshot.fullStateHash,
          snapshotToken: snapshot.snapshotToken,
        },
      };
    } catch (err) {
      lastError = err;
      try {
        sidecar?.detach();
      } catch {
        // ignore cleanup errors before publication
      }
      await handle?.dispose().catch(() => undefined);
      await lifecycle?.dispose().catch(() => undefined);
      if (
        err instanceof Error &&
        err.name === 'CollaborationRoomChangedRefetchError' &&
        attempt === 0
      ) {
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------------------------------------------------------------------------
// Import (XLSX)
// ---------------------------------------------------------------------------

/**
 * Import an XLSX file into a new host-backed document.
 *
 * This is the host-backed equivalent of `DocumentFactory.createFromXlsx`.
 * The trusted adapter provides the XLSX bytes; the lifecycle system handles
 * hydration.
 *
 * @param host - Validated host context (principal, storage, runtime, etc.)
 * @param bindings - Trusted adapter composition bindings
 * @param options - Import parameters including the XLSX data
 * @returns A fully initialized DocumentHandle with the imported content
 */
export async function importHostBackedDocument(
  host: KernelHostContext,
  bindings: HostKernelAdapterBindings,
  options: ImportHostBackedDocumentOptions = {},
): Promise<ImportHostBackedDocumentResult> {
  if (
    'interactiveDeferredImportToken' in options &&
    options.interactiveDeferredImportToken !== INTERNAL_INTERACTIVE_DEFERRED_IMPORT
  ) {
    const err = new Error(
      'interactiveDeferredImportToken is invalid for host-backed XLSX import.',
    ) as Error & {
      code?: string;
      scope?: 'allSheets';
    };
    err.code = 'invalid_interactive_import_option';
    err.scope = 'allSheets';
    throw err;
  }

  const lifecycleInput = prepareHostBackedDocument(host, bindings);
  if (!lifecycleInput.documentRef) {
    throw new Error('Host-backed XLSX import requires an authorized source-handle documentRef');
  }
  const resolvedSource = await validateAndResolveImportSource({
    documentRef: lifecycleInput.documentRef,
    storage: lifecycleInput.storage.handoff,
    sourceHandleResolvers: lifecycleInput.bindings.bindings.sourceHandleResolvers,
    replayRegistry: lifecycleInput.operationAuthorization.replayRegistry,
    principalFingerprint: lifecycleInput.operationAuthorization.principalFingerprint,
    resourceContextFingerprint: lifecycleInput.operationAuthorization.resourceContextFingerprint,
    diagnostics: lifecycleInput.diagnostics,
    clock: lifecycleInput.clock,
  });

  const lifecycle = new DocumentLifecycleSystem({
    kind: 'host-backed',
    lifecycleInput,
  });

  lifecycle.createFromXlsx(
    lifecycleInput.documentId,
    {},
    { type: 'bytes', data: resolvedSource.bytes },
    options.importOptions,
  );
  await lifecycle.waitForReady();
  if (options.interactiveDeferredImportToken !== INTERNAL_INTERACTIVE_DEFERRED_IMPORT) {
    // Match the direct DocumentFactory import contract: host-backed handles are
    // returned only after deferred import hydration is mutation-ready/durable.
    await lifecycle.awaitImportDurability();
  }

  const context = lifecycle.documentContext;
  const importDiagnostics = (await lifecycle.computeBridge.getImportDiagnostics()).map(
    projectImportDiagnostic,
  );
  const importWarnings = documentImportWarningsFromDiagnostics(importDiagnostics);
  const handle = _createDocumentHandleInternal(
    lifecycleInput.documentId,
    lifecycle,
    context,
    undefined,
    importWarnings,
  );
  return { handle, importWarnings };
}

export async function importHostBackedInteractiveDeferredDocument(
  host: KernelHostContext,
  bindings: HostKernelAdapterBindings,
  options: ImportHostBackedInteractiveDeferredDocumentOptions = {},
): Promise<ImportHostBackedDocumentResult> {
  return importHostBackedDocument(host, bindings, {
    importOptions: options.importOptions,
    interactiveDeferredImportToken: INTERNAL_INTERACTIVE_DEFERRED_IMPORT,
  });
}

// ---------------------------------------------------------------------------
// Raw Headless Creation
// ---------------------------------------------------------------------------

/**
 * Create a raw headless document for trusted runtime adapters.
 *
 * This exists for the SDK collaboration path that must boot from raw Yrs state
 * and a preloaded N-API addon. Public SDK calls should prefer the host-backed
 * creation helpers above.
 */
export async function createHeadlessDocument(
  options: CreateHeadlessDocumentOptions,
): Promise<DocumentSyncCapableHandle> {
  const lifecycle = new DocumentLifecycleSystem({
    environment: 'headless',
    napiAddon: options.napiAddon,
    userTimezone: options.userTimezone,
    clock: options.clock,
    workbookLinkResolver: options.workbookLinkResolver as any,
    workbookLinkScope: options.workbookLinkScope as any,
  });
  lifecycle.create(options.documentId, {
    documentId: options.documentId,
    initialSnapshot: options.initialSnapshot,
    yrsState: options.yrsState,
  });
  await lifecycle.waitForReady();

  const context = lifecycle.documentContext;
  return _createDocumentHandleInternal(options.documentId, lifecycle, context);
}

export async function importHeadlessDocumentFromXlsx(
  source: { readonly type: 'bytes'; readonly data: Uint8Array },
  options: HeadlessDocumentImportOptions,
): Promise<DocumentSyncCapableHandle> {
  const lifecycle = new DocumentLifecycleSystem({
    environment: 'headless',
    napiAddon: options.napiAddon,
    userTimezone: options.userTimezone,
    clock: options.clock,
    workbookLinkResolver: options.workbookLinkResolver as any,
    workbookLinkScope: options.workbookLinkScope as any,
  });
  lifecycle.createFromXlsx(options.documentId, { skipDefaultSheet: true }, source, {
    documentId: options.documentId,
    ...options.importOptions,
  });
  await lifecycle.waitForReady();
  await lifecycle.awaitImportDurability();

  const context = lifecycle.documentContext;
  const importDiagnostics = (await lifecycle.computeBridge.getImportDiagnostics()).map(
    projectImportDiagnostic,
  );
  const importWarnings = documentImportWarningsFromDiagnostics(importDiagnostics);
  return _createDocumentHandleInternal(
    options.documentId,
    lifecycle,
    context,
    undefined,
    importWarnings,
  );
}

function assertEphemeralCollaborationStorage(storage: {
  readonly durability: string;
  readonly providers: readonly unknown[];
}): void {
  if (storage.durability !== 'ephemeral' || storage.providers.length !== 0) {
    throw new Error(
      'Host-backed collaboration joins require ephemeral storage with no local providers',
    );
  }
}

function canonicalizeRoomUrl(baseUrl: string, roomId: string): string {
  validateRoomId(roomId);
  const url = new URL(baseUrl);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Collaboration room baseUrl must use ws: or wss:, got ${url.protocol}`);
  }
  if (url.search || url.hash) {
    throw new Error('Collaboration room baseUrl must not include query or fragment');
  }
  const prefix = url.pathname.replace(/\/+$/, '');
  url.pathname = `${prefix}/${encodeURIComponent(roomId)}`;
  if (decodeURIComponent(url.pathname.split('/').pop() ?? '') !== roomId) {
    throw new Error('Collaboration room URL normalization changed the room id segment');
  }
  return url.toString();
}

function validateRoomId(roomId: string): void {
  if (!roomId || roomId === '.' || roomId === '..' || /[/?#]/.test(roomId)) {
    throw new Error(`Invalid collaboration room id: ${roomId}`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createRoomBackedHandle(
  handle: DocumentHandle,
  sidecar: FlushableCollaborationSidecar,
  finalFlushMs = 10_000,
): DocumentHandle {
  let closed = false;
  let closing: Promise<void> | null = null;
  let finalFlushInProgress = false;
  let finalFlushFailed = false;

  const flushAndDispose = async (options?: { readonly timeoutMs?: number }): Promise<void> => {
    if (closed) return;
    if (closing) {
      await closing;
      return;
    }

    finalFlushInProgress = true;
    finalFlushFailed = false;
    closing = (async () => {
      await sidecar.flushAndDetach({ timeoutMs: options?.timeoutMs ?? finalFlushMs });
      await handle.dispose();
      closed = true;
    })();

    try {
      await closing;
    } catch (err) {
      finalFlushFailed = true;
      throw err;
    } finally {
      finalFlushInProgress = false;
      if (!closed) {
        closing = null;
      }
    }
  };

  const checkpoint = async (): Promise<CheckpointResult> => ({
    status: 'committed',
    highWaterMark: {
      mark: `room-backed:${handle.documentId}`,
      capturedAt: Date.now(),
      pendingMutationCount: 0,
    },
    providerResults: [],
    timestamp: Date.now(),
  });

  const close = async (options?: { readonly timeoutMs?: number }): Promise<CloseResult> => {
    const finalCheckpoint = await checkpoint();
    await flushAndDispose(options);
    return {
      status: 'closed',
      finalCheckpoint,
      detachedProviders: [],
      errors: [],
      timestamp: Date.now(),
    };
  };

  const roomBackedHandle = Object.create(handle) as DocumentHandle;
  Object.defineProperties(roomBackedHandle, {
    isDisposed: {
      enumerable: true,
      get() {
        return closed || handle.isDisposed;
      },
    },
    flushSync: {
      enumerable: true,
      value(): void {
        // Room-backed documents are not persisted through local Providers.
      },
    },
    pendingUpdatesCount: {
      enumerable: true,
      get() {
        return finalFlushInProgress ? 1 : 0;
      },
    },
    hasFlushFailed: {
      enumerable: true,
      get() {
        return finalFlushFailed;
      },
    },
    checkpoint: { enumerable: true, value: checkpoint },
    close: { enumerable: true, value: close },
    dispose: { enumerable: true, value: flushAndDispose },
    disposeAsync: { enumerable: true, value: flushAndDispose },
    [Symbol.asyncDispose]: { enumerable: false, value: flushAndDispose },
  });
  return roomBackedHandle;
}
