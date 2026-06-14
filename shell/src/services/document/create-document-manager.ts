/**
 * DocumentManager Factory
 *
 * Creates a DocumentManager instance that manages document lifecycle
 * at the shell level. This is a singleton per shell instance, created
 * during shell bootstrap before React mounts.
 *
 * Key implementation details:
 * - Uses Maps to store state outside React's component tree
 * - Deduplicates concurrent load requests via loadingPromises Map
 * - Notifies subscribers on any state change
 *
 */

import { DocumentFactory, type CollaborationSidecar, type DocumentHandle } from '@mog-sdk/kernel';
import type { DocumentSource } from '@mog-sdk/contracts/document';
import {
  createStandaloneBrowserHostBackedCollaborationDocument,
  createStandaloneBrowserHostBackedDocument,
  createStandaloneBrowserShellHost,
} from '../../host-adapters/standalone-browser-host';
import type { StandaloneBrowserShellResult } from '../../host-adapters/standalone-browser-host';
import {
  registerLifecycleHooks,
  type LifecycleDocumentHandle,
} from '../../host/hooks/app-document-lifecycle';
import type { DocumentManager } from './document-manager';
import type {
  CreateDocumentOptions,
  CreateCollaborationDocumentOptions,
  DocumentManagerOptions,
  DocumentLoadingState,
  DocumentManagerListener,
  DocumentManagerState,
  LoadDocumentOptions,
  ShellDocumentMode,
  Unsubscribe,
} from './types';
import {
  attachImportedPivotMetadata,
  extractImportedPivotMetadata,
} from './imported-pivot-metadata';
import { importInteractiveHostBackedDocument } from './import-interactive-host-backed-document';

/**
 * Create a DocumentManager instance.
 *
 * This is the factory function that creates the singleton DocumentManager
 * for a shell instance. Should be called once during shell bootstrap.
 *
 * @returns DocumentManager instance
 *
 * @example
 * ```typescript
 * // In shell bootstrap (create-shell.ts):
 * const documentManager = createDocumentManager();
 *
 * // In ProjectService:
 * await documentManager.loadDocument(fileId, { type: 'path', path: '/foo.xlsx' });
 *
 * // In React hooks:
 * const handle = documentManager.getDocument(fileId);
 * ```
 */
// ---------------------------------------------------------------------------
// Host Adapter Defaults
// ---------------------------------------------------------------------------
// The standalone browser host adapter requires explicit wasmBaseUrl and
// workerUrl in its config (for the formal KernelRuntimeConfig). The actual
// WASM module loading is bundler-resolved via dynamic import('@mog-sdk/wasm')
// in the transport layer — these URLs feed the host protocol's runtime config
// and transport bindings but are not used for actual fetch() calls in the
// browser-wasm-worker runtime.
const DEFAULT_HOST_WASM_BASE_URL = '/';
const DEFAULT_HOST_WORKER_URL = '/worker.js';

type LoadedDocumentResources = {
  handle: DocumentHandle;
  hostAdapter: StandaloneBrowserShellResult | null;
};

type LoadingDocumentMode =
  | { readonly kind: 'normal'; readonly skipLocalPersistence: boolean }
  | {
      readonly kind: 'collaboration';
      readonly documentId: string;
      readonly roomId: string;
      readonly roomUrl: string;
      readonly participantId: string;
    };

class DocumentOpenAbortedError extends Error {
  constructor(fileId: string) {
    super(`[DocumentManager] open for fileId="${fileId}" was disposed before it completed`);
    this.name = 'DocumentOpenAbortedError';
  }
}

class DocumentModeConflictError extends Error {
  constructor(fileId: string, message: string) {
    super(`[DocumentManager] document mode conflict for fileId="${fileId}": ${message}`);
    this.name = 'DocumentModeConflictError';
  }
}

export function createDocumentManager(options: DocumentManagerOptions = {}): DocumentManager {
  const runtimeAssets = {
    wasmBaseUrl: options.runtimeAssets?.wasmBaseUrl ?? DEFAULT_HOST_WASM_BASE_URL,
    workerUrl: options.runtimeAssets?.workerUrl ?? DEFAULT_HOST_WORKER_URL,
    staticAssetBase: options.runtimeAssets?.staticAssetBase,
  };
  const runtimeAssetConfig = {
    wasmBaseUrl: runtimeAssets.wasmBaseUrl,
    workerUrl: runtimeAssets.workerUrl,
    ...(runtimeAssets.staticAssetBase ? { staticAssetBase: runtimeAssets.staticAssetBase } : {}),
  };
  // ---------------------------------------------------------------------------
  // Internal State
  // ---------------------------------------------------------------------------

  /** Map of fileId to loaded document handle */
  const documents = new Map<string, DocumentHandle>();

  /** Map of fileId to loading promise (for deduplication) */
  const loadingPromises = new Map<string, Promise<DocumentHandle>>();

  /** Generation for each in-flight loading promise. */
  const loadingGenerations = new Map<string, number>();

  /** Generation for each loaded document. */
  const documentGenerations = new Map<string, number>();

  /** Per-file lifecycle queue. Serializes create/load/dispose for one public fileId. */
  const operationChains = new Map<string, Promise<void>>();

  /** In-flight load generations that must be closed instead of published. */
  const disposeRequestedGenerations = new Map<string, Set<number>>();

  let nextGeneration = 0;

  /** Terminal after disposeAll(); this manager is a shell-lifetime object. */
  let disposedAll = false;

  /** Map of fileId to loading state */
  const loadingStates = new Map<string, DocumentLoadingState>();

  /** Map of fileId to error */
  const errors = new Map<string, Error>();

  /** Set of subscribed listeners */
  const listeners = new Set<DocumentManagerListener>();

  /** Map of fileId to collab sidecar (for WS detach on dispose) */
  const sidecars = new Map<string, CollaborationSidecar>();

  /** Map of fileId to host adapter result (for disposal when document is closed) */
  const hostAdapters = new Map<string, StandaloneBrowserShellResult>();

  /** Map of fileId to normal/collaboration mode metadata. */
  const documentModes = new Map<string, ShellDocumentMode>();

  /** Mode requested by each in-flight open. Used to reject incompatible dedupe. */
  const loadingModes = new Map<string, LoadingDocumentMode>();

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get current state snapshot (immutable).
   */
  const getState = (): DocumentManagerState => ({
    documents: new Map(documents),
    documentModes: new Map(documentModes),
    loadingStates: new Map(loadingStates),
    errors: new Map(errors),
  });

  /**
   * Notify all subscribers of state change.
   */
  const notify = (): void => {
    const state = getState();
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('[DocumentManager] Listener error:', err);
      }
    });
  };

  /**
   * Set loading state for a file and notify subscribers.
   */
  const setLoadingState = (fileId: string, state: DocumentLoadingState): void => {
    loadingStates.set(fileId, state);
    notify();
  };

  /**
   * Set error for a file and notify subscribers.
   */
  const setError = (fileId: string, error: Error): void => {
    errors.set(fileId, error);
    setLoadingState(fileId, 'error');
  };

  /**
   * Clear error for a file.
   */
  const clearError = (fileId: string): void => {
    errors.delete(fileId);
  };

  const allocateGeneration = (): number => {
    nextGeneration += 1;
    return nextGeneration;
  };

  const requestDisposeGeneration = (fileId: string, generation: number | undefined): void => {
    if (generation === undefined) return;
    const set = disposeRequestedGenerations.get(fileId) ?? new Set<number>();
    set.add(generation);
    disposeRequestedGenerations.set(fileId, set);
  };

  const isDisposeRequested = (fileId: string, generation: number): boolean =>
    disposeRequestedGenerations.get(fileId)?.has(generation) === true;

  const clearDisposeRequest = (fileId: string, generation: number | undefined): void => {
    if (generation === undefined) return;
    const set = disposeRequestedGenerations.get(fileId);
    if (!set) return;
    set.delete(generation);
    if (set.size === 0) {
      disposeRequestedGenerations.delete(fileId);
    }
  };

  const collaborationModeMatches = (
    mode: ShellDocumentMode | LoadingDocumentMode | undefined,
    options: CreateCollaborationDocumentOptions,
    roomUrl: string,
  ): boolean =>
    mode?.kind === 'collaboration' &&
    mode.documentId === options.documentId &&
    mode.roomId === options.roomId &&
    mode.roomUrl === roomUrl &&
    mode.participantId === options.participantId;

  const canonicalizeCollaborationRoomUrl = (baseUrl: string, roomId: string): string => {
    if (!roomId || roomId === '.' || roomId === '..' || /[/?#]/.test(roomId)) {
      throw new Error(`Invalid collaboration room id: ${roomId}`);
    }
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
  };

  const enqueueFileOperation = <T>(fileId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = operationChains.get(fileId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const chain = run.then(
      () => undefined,
      () => undefined,
    );
    operationChains.set(fileId, chain);
    void chain.finally(() => {
      if (operationChains.get(fileId) === chain) {
        operationChains.delete(fileId);
      }
    });
    return run;
  };

  const disposeLoadedResources = async (
    fileId: string,
    resources: LoadedDocumentResources,
  ): Promise<void> => {
    const sidecar = sidecars.get(fileId);
    const mode = documentModes.get(fileId);
    if (sidecar && mode?.kind !== 'collaboration') {
      try {
        sidecar.detach();
      } catch (err) {
        console.error(`[DocumentManager] Failed to detach sidecar for ${fileId}:`, err);
      }
      sidecars.delete(fileId);
    }

    await Promise.all([
      resources.hostAdapter?.dispose() ?? Promise.resolve(),
      resources.handle.dispose(),
    ]);
  };

  const throwIfManagerDisposed = (): void => {
    if (disposedAll) {
      throw new Error('[DocumentManager] manager has been disposed');
    }
  };

  async function loadFreshDocumentHandle(
    fileId: string,
    source: DocumentSource,
    options?: LoadDocumentOptions,
  ): Promise<LoadedDocumentResources> {
    const kind = options?.kind ?? 'xlsx';

    // --- Legacy CSV fallback ---
    // The host-backed import path only handles XLSX for now. CSV stays on the
    // legacy DocumentFactory path until a host-backed CSV import is implemented.
    if (kind === 'csv') {
      const result = await DocumentFactory.createFromCsv(source, {
        documentId: fileId,
        csvOptions: options?.csvOptions,
      });
      if (!result.success || !result.handle) {
        throw result.error ?? new Error('Failed to import CSV document');
      }
      if (result.handle.documentId !== fileId) {
        throw new Error(
          `Document identity mismatch: fileId=${fileId}, documentId=${result.handle.documentId}`,
        );
      }
      return { handle: result.handle, hostAdapter: null };
    }

    // --- Host-backed XLSX import (bytes source) ---
    if (source.type === 'bytes') {
      const hostResult = createStandaloneBrowserShellHost({
        documentId: fileId,
        ...runtimeAssetConfig,
        operation: 'import',
        importBytes: source.data,
        skipLocalPersistence: options?.skipLocalPersistence,
      });

      try {
        const handle = await importInteractiveHostBackedDocument(hostResult);
        if (handle.documentId !== fileId) {
          throw new Error(
            `Document identity mismatch: fileId=${fileId}, documentId=${handle.documentId}`,
          );
        }
        try {
          attachImportedPivotMetadata(handle, await extractImportedPivotMetadata(source.data));
        } catch (metadataError) {
          console.warn('[DocumentManager] failed to extract imported PivotTable metadata', {
            fileId,
            error: metadataError,
          });
          attachImportedPivotMetadata(handle, {
            pivots: [],
            diagnostics: [
              metadataError instanceof Error ? metadataError.message : String(metadataError),
            ],
          });
        }
        return { handle, hostAdapter: hostResult };
      } catch (error) {
        await hostResult.dispose();
        throw error;
      }
    }

    throw new Error(
      'Path document sources are not accepted by the standalone shell document manager; read through the shell IPC boundary and pass bytes or wire an explicit host source resolver.',
    );
  }

  async function publishLoadedDocument(
    fileId: string,
    generation: number,
    resources: LoadedDocumentResources,
    mode: ShellDocumentMode,
  ): Promise<DocumentHandle> {
    if (disposedAll || isDisposeRequested(fileId, generation)) {
      await disposeLoadedResources(fileId, resources);
      loadingStates.delete(fileId);
      errors.delete(fileId);
      documentModes.delete(fileId);
      notify();
      throw new DocumentOpenAbortedError(fileId);
    }

    if (resources.hostAdapter) {
      hostAdapters.set(fileId, resources.hostAdapter);
    }
    documents.set(fileId, resources.handle);
    documentModes.set(fileId, mode);
    documentGenerations.set(fileId, generation);
    setLoadingState(fileId, 'loaded');
    return resources.handle;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const manager: DocumentManager = {
    async loadDocument(
      fileId: string,
      source: DocumentSource,
      options?: LoadDocumentOptions,
    ): Promise<DocumentHandle> {
      throwIfManagerDisposed();

      // 1. Cache hit: return existing document
      const existingDoc = documents.get(fileId);
      const existingGeneration = documentGenerations.get(fileId);
      if (
        existingDoc &&
        (existingGeneration === undefined || !isDisposeRequested(fileId, existingGeneration))
      ) {
        if (documentModes.get(fileId)?.kind === 'collaboration') {
          throw new DocumentModeConflictError(fileId, 'loaded document is collaboration-backed');
        }
        return existingDoc;
      }

      // 2. Deduplication: return existing loading promise
      const existingPromise = loadingPromises.get(fileId);
      const existingLoadingGeneration = loadingGenerations.get(fileId);
      if (
        existingPromise &&
        (existingLoadingGeneration === undefined ||
          !isDisposeRequested(fileId, existingLoadingGeneration))
      ) {
        if (loadingModes.get(fileId)?.kind === 'collaboration') {
          throw new DocumentModeConflictError(fileId, 'in-flight open is collaboration-backed');
        }
        return existingPromise;
      }

      // 3. Start new load. The generation lets a dispose request that arrives
      // while the async open is in flight abort publication and dispose the
      // just-created resources before they become visible through the manager.
      const generation = allocateGeneration();
      clearError(fileId);
      setLoadingState(fileId, 'loading');
      loadingModes.set(fileId, {
        kind: 'normal',
        skipLocalPersistence: options?.skipLocalPersistence === true,
      });

      let promise!: Promise<DocumentHandle>;
      promise = enqueueFileOperation(fileId, async (): Promise<DocumentHandle> => {
        try {
          if (disposedAll || isDisposeRequested(fileId, generation)) {
            throw new DocumentOpenAbortedError(fileId);
          }
          const queuedExistingDoc = documents.get(fileId);
          const queuedExistingGeneration = documentGenerations.get(fileId);
          if (
            queuedExistingDoc &&
            (queuedExistingGeneration === undefined ||
              !isDisposeRequested(fileId, queuedExistingGeneration))
          ) {
            if (documentModes.get(fileId)?.kind === 'collaboration') {
              throw new DocumentModeConflictError(
                fileId,
                'loaded document is collaboration-backed',
              );
            }
            return queuedExistingDoc;
          }

          const resources = await loadFreshDocumentHandle(fileId, source, options);
          return await publishLoadedDocument(fileId, generation, resources, {
            kind: 'normal',
            documentId: resources.handle.documentId,
            skipLocalPersistence: options?.skipLocalPersistence === true,
          });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (error instanceof DocumentOpenAbortedError) {
            loadingStates.delete(fileId);
            errors.delete(fileId);
            notify();
            throw error;
          }
          // Log the full cause chain — wrapper errors (EngineCreateError, HydrationError)
          // store the real failure in .cause which browsers don't always display.
          let rootCause: unknown = error;
          while (rootCause instanceof Error && rootCause.cause) {
            rootCause = rootCause.cause;
          }
          console.error(
            `[DocumentManager] Failed to load ${fileId}:`,
            error.message,
            '\n  Root cause:',
            rootCause,
          );
          setError(fileId, error);
          throw error;
        } finally {
          if (loadingPromises.get(fileId) === promise) {
            loadingPromises.delete(fileId);
            loadingGenerations.delete(fileId);
            loadingModes.delete(fileId);
          }
          clearDisposeRequest(fileId, generation);
        }
      });

      loadingPromises.set(fileId, promise);
      loadingGenerations.set(fileId, generation);
      void promise.catch(() => undefined);
      return promise;
    },

    async createDocument(fileId: string, options?: CreateDocumentOptions): Promise<DocumentHandle> {
      throwIfManagerDisposed();
      const operation = options?.operation ?? 'create';

      // 1. Cache hit: opening is idempotent, creating replaces the old normal doc.
      const existingDoc = documents.get(fileId);
      const existingGeneration = documentGenerations.get(fileId);
      if (
        existingDoc &&
        (existingGeneration === undefined || !isDisposeRequested(fileId, existingGeneration))
      ) {
        if (documentModes.get(fileId)?.kind === 'collaboration') {
          throw new DocumentModeConflictError(fileId, 'loaded document is collaboration-backed');
        }
        if (operation === 'open') {
          return existingDoc;
        }
      }

      // 2. Deduplication: return existing loading promise
      const existingPromise = loadingPromises.get(fileId);
      const existingLoadingGeneration = loadingGenerations.get(fileId);
      if (
        existingPromise &&
        (existingLoadingGeneration === undefined ||
          !isDisposeRequested(fileId, existingLoadingGeneration))
      ) {
        if (loadingModes.get(fileId)?.kind === 'collaboration') {
          throw new DocumentModeConflictError(fileId, 'in-flight open is collaboration-backed');
        }
        return existingPromise;
      }

      // 3. Create new document via host-backed lifecycle
      const generation = allocateGeneration();
      clearError(fileId);
      setLoadingState(fileId, 'loading');
      loadingModes.set(fileId, {
        kind: 'normal',
        skipLocalPersistence: options?.skipLocalPersistence === true,
      });

      let promise!: Promise<DocumentHandle>;
      promise = enqueueFileOperation(fileId, async (): Promise<DocumentHandle> => {
        let hostResult: StandaloneBrowserShellResult | null = null;
        try {
          if (disposedAll || isDisposeRequested(fileId, generation)) {
            throw new DocumentOpenAbortedError(fileId);
          }
          const queuedExistingDoc = documents.get(fileId);
          const queuedExistingGeneration = documentGenerations.get(fileId);
          if (
            queuedExistingDoc &&
            (queuedExistingGeneration === undefined ||
              !isDisposeRequested(fileId, queuedExistingGeneration))
          ) {
            if (documentModes.get(fileId)?.kind === 'collaboration') {
              throw new DocumentModeConflictError(
                fileId,
                'loaded document is collaboration-backed',
              );
            }
            if (operation === 'open') {
              return queuedExistingDoc;
            }

            const queuedHostAdapter = hostAdapters.get(fileId) ?? null;
            hostAdapters.delete(fileId);
            documents.delete(fileId);
            documentModes.delete(fileId);
            documentGenerations.delete(fileId);
            loadingStates.delete(fileId);
            errors.delete(fileId);
            notify();
            await disposeLoadedResources(fileId, {
              handle: queuedExistingDoc,
              hostAdapter: queuedHostAdapter,
            });
          }

          const documentId = options?.documentId ?? fileId;

          // Create a standalone browser host context for this document.
          hostResult = createStandaloneBrowserShellHost({
            documentId,
            ...runtimeAssetConfig,
            operation,
            workbookLinkResolver: options?.workbookLinkResolver,
            skipLocalPersistence: options?.skipLocalPersistence,
          });

          // Create the document through the host-backed lifecycle.
          const handle = await createStandaloneBrowserHostBackedDocument(hostResult, {
            skipDefaultSheet: options?.skipDefaultSheet,
          });
          const resources = { handle, hostAdapter: hostResult };
          hostResult = null;

          return await publishLoadedDocument(fileId, generation, resources, {
            kind: 'normal',
            documentId: handle.documentId,
            skipLocalPersistence: options?.skipLocalPersistence === true,
          });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (error instanceof DocumentOpenAbortedError) {
            loadingStates.delete(fileId);
            errors.delete(fileId);
            notify();
            throw error;
          }
          if (hostResult && !hostAdapters.has(fileId)) {
            await hostResult.dispose().catch((disposeError) => {
              console.error(
                `[DocumentManager] Failed to dispose aborted host adapter for ${fileId}:`,
                disposeError,
              );
            });
          }
          console.error(`[DocumentManager] Failed to create ${fileId}:`, error);
          setError(fileId, error);
          throw error;
        } finally {
          if (loadingPromises.get(fileId) === promise) {
            loadingPromises.delete(fileId);
            loadingGenerations.delete(fileId);
            loadingModes.delete(fileId);
          }
          clearDisposeRequest(fileId, generation);
        }
      });

      loadingPromises.set(fileId, promise);
      loadingGenerations.set(fileId, generation);
      void promise.catch(() => undefined);
      return promise;
    },

    async createCollaborationDocument(
      fileId: string,
      options: CreateCollaborationDocumentOptions,
    ): Promise<DocumentHandle> {
      throwIfManagerDisposed();
      const roomUrl = canonicalizeCollaborationRoomUrl(options.baseUrl, options.roomId);

      const existingDoc = documents.get(fileId);
      const existingMode = documentModes.get(fileId);
      const existingGeneration = documentGenerations.get(fileId);
      if (
        existingDoc &&
        (existingGeneration === undefined || !isDisposeRequested(fileId, existingGeneration))
      ) {
        if (collaborationModeMatches(existingMode, options, roomUrl)) {
          return existingDoc;
        }
        throw new DocumentModeConflictError(
          fileId,
          'loaded document is not the requested collaboration room',
        );
      }

      const existingPromise = loadingPromises.get(fileId);
      const existingLoadingGeneration = loadingGenerations.get(fileId);
      if (
        existingPromise &&
        (existingLoadingGeneration === undefined ||
          !isDisposeRequested(fileId, existingLoadingGeneration))
      ) {
        if (collaborationModeMatches(loadingModes.get(fileId), options, roomUrl)) {
          return existingPromise;
        }
        throw new DocumentModeConflictError(
          fileId,
          'in-flight open is not the requested collaboration room',
        );
      }

      const generation = allocateGeneration();
      clearError(fileId);
      setLoadingState(fileId, 'loading');
      loadingModes.set(fileId, {
        kind: 'collaboration',
        documentId: options.documentId,
        roomId: options.roomId,
        roomUrl,
        participantId: options.participantId,
      });

      let promise!: Promise<DocumentHandle>;
      promise = enqueueFileOperation(fileId, async (): Promise<DocumentHandle> => {
        let hostResult: StandaloneBrowserShellResult | null = null;
        let handle: DocumentHandle | null = null;
        let sidecar: CollaborationSidecar | null = null;
        try {
          if (disposedAll || isDisposeRequested(fileId, generation)) {
            throw new DocumentOpenAbortedError(fileId);
          }
          const queuedExistingDoc = documents.get(fileId);
          const queuedExistingGeneration = documentGenerations.get(fileId);
          if (
            queuedExistingDoc &&
            (queuedExistingGeneration === undefined ||
              !isDisposeRequested(fileId, queuedExistingGeneration))
          ) {
            if (collaborationModeMatches(documentModes.get(fileId), options, roomUrl)) {
              return queuedExistingDoc;
            }
            throw new DocumentModeConflictError(
              fileId,
              'loaded document is not the requested collaboration room',
            );
          }

          hostResult = createStandaloneBrowserShellHost({
            documentId: options.documentId,
            ...runtimeAssetConfig,
            operation: 'open',
            skipLocalPersistence: true,
          });

          const result = await createStandaloneBrowserHostBackedCollaborationDocument(
            hostResult,
            options,
          );
          handle = result.handle;
          sidecar = result.sidecar;
          if (handle.documentId !== options.documentId) {
            throw new Error(
              `Collaboration document identity mismatch: expected=${options.documentId}, got=${handle.documentId}`,
            );
          }
          if (result.room.roomUrl !== roomUrl) {
            throw new Error(
              `Collaboration roomUrl mismatch: shell=${roomUrl}, host=${result.room.roomUrl}`,
            );
          }
          const resources = { handle, hostAdapter: hostResult };

          if (disposedAll || isDisposeRequested(fileId, generation)) {
            try {
              sidecar.detach();
            } catch {
              /* ignore cleanup errors before publication */
            }
            await Promise.allSettled([handle.dispose(), hostResult.dispose()]);
            hostResult = null;
            loadingStates.delete(fileId);
            errors.delete(fileId);
            notify();
            throw new DocumentOpenAbortedError(fileId);
          }

          sidecars.set(fileId, sidecar);
          const published = await publishLoadedDocument(fileId, generation, resources, {
            kind: 'collaboration',
            documentId: options.documentId,
            roomId: result.room.roomId,
            roomUrl: result.room.roomUrl,
            participantId: options.participantId,
            bootstrapRoomEpoch: result.room.roomEpoch,
            bootstrapFullStateHash: result.room.fullStateHash,
            bootstrapSnapshotToken: result.room.snapshotToken,
          });
          hostResult = null;
          return published;
        } catch (err) {
          if (sidecar && !sidecars.has(fileId)) {
            try {
              sidecar.detach();
            } catch {
              /* ignore */
            }
          }
          if (handle && !documents.has(fileId)) {
            await handle.dispose().catch(() => undefined);
          }
          if (hostResult && !hostAdapters.has(fileId)) {
            await hostResult.dispose().catch(() => undefined);
          }
          const error = err instanceof Error ? err : new Error(String(err));
          if (error instanceof DocumentOpenAbortedError) {
            loadingStates.delete(fileId);
            errors.delete(fileId);
            notify();
            throw error;
          }
          console.error(
            `[DocumentManager] Failed to create collaboration document ${fileId}:`,
            error,
          );
          setError(fileId, error);
          throw error;
        } finally {
          if (loadingPromises.get(fileId) === promise) {
            loadingPromises.delete(fileId);
            loadingGenerations.delete(fileId);
            loadingModes.delete(fileId);
          }
          clearDisposeRequest(fileId, generation);
        }
      });

      loadingPromises.set(fileId, promise);
      loadingGenerations.set(fileId, generation);
      void promise.catch(() => undefined);
      return promise;
    },

    getDocument(fileId: string): DocumentHandle | null {
      return documents.get(fileId) ?? null;
    },

    getSidecar(fileId: string): CollaborationSidecar | null {
      return sidecars.get(fileId) ?? null;
    },

    getDocumentMode(fileId: string): ShellDocumentMode | null {
      return documentModes.get(fileId) ?? null;
    },

    async attachSidecar(
      fileId: string,
      config: { url: string; roomId: string; participantId: string },
    ): Promise<void> {
      throw new Error(
        `[DocumentManager] attachSidecar is not a first-join API. Use createCollaborationDocument for room ${config.roomId}.`,
      );
    },

    detachSidecar(fileId: string): void {
      if (documentModes.get(fileId)?.kind === 'collaboration') {
        throw new Error(
          `[DocumentManager] detachSidecar cannot detach room-backed collaboration documents; use closeCollaborationDocument for ${fileId}.`,
        );
      }
      const sidecar = sidecars.get(fileId);
      if (sidecar) {
        sidecar.detach();
        sidecars.delete(fileId);
        notify();
      }
    },

    async closeCollaborationDocument(
      fileId: string,
      options?: { readonly timeoutMs?: number },
    ): Promise<void> {
      await enqueueFileOperation(fileId, async () => {
        const mode = documentModes.get(fileId);
        if (mode?.kind !== 'collaboration') {
          throw new DocumentModeConflictError(fileId, 'not a collaboration document');
        }
        const handle = documents.get(fileId);
        if (!handle) return;
        const hostAdapter = hostAdapters.get(fileId) ?? null;

        await (
          handle as DocumentHandle & {
            dispose(options?: { readonly timeoutMs?: number }): Promise<void>;
          }
        ).dispose(options);
        await hostAdapter?.dispose();

        hostAdapters.delete(fileId);
        sidecars.delete(fileId);
        documents.delete(fileId);
        documentModes.delete(fileId);
        documentGenerations.delete(fileId);
        loadingStates.delete(fileId);
        errors.delete(fileId);
        notify();
      });
    },

    async disposeDocument(fileId: string): Promise<void> {
      const loadingGeneration = loadingGenerations.get(fileId);
      requestDisposeGeneration(fileId, loadingGeneration);

      if (documentModes.get(fileId)?.kind === 'collaboration') {
        try {
          await manager.closeCollaborationDocument(fileId);
        } catch (err) {
          clearDisposeRequest(fileId, loadingGeneration);
          throw err;
        }
        return;
      }

      requestDisposeGeneration(fileId, documentGenerations.get(fileId));

      await enqueueFileOperation(fileId, async () => {
        const handle = documents.get(fileId);
        if (!handle) {
          loadingStates.delete(fileId);
          errors.delete(fileId);
          notify();
          return;
        }

        const hostAdapter = hostAdapters.get(fileId) ?? null;
        hostAdapters.delete(fileId);
        documents.delete(fileId);
        documentModes.delete(fileId);
        documentGenerations.delete(fileId);
        loadingStates.delete(fileId);
        errors.delete(fileId);
        notify();

        await disposeLoadedResources(fileId, { handle, hostAdapter });
      });
    },

    async disposeAll(): Promise<void> {
      disposedAll = true;
      for (const [fileId, generation] of loadingGenerations) {
        requestDisposeGeneration(fileId, generation);
      }
      for (const [fileId, generation] of documentGenerations) {
        if (documentModes.get(fileId)?.kind !== 'collaboration') {
          requestDisposeGeneration(fileId, generation);
        }
      }

      const fileIds = new Set<string>([
        ...documents.keys(),
        ...loadingGenerations.keys(),
        ...operationChains.keys(),
      ]);

      const entries = Array.from(fileIds, (fileId) => ({
        fileId,
        mode: documentModes.get(fileId),
      }));
      const results = await Promise.allSettled(
        entries.map((entry) => manager.disposeDocument(entry.fileId)),
      );
      const failures = results
        .map((result, index) => ({ result, entry: entries[index] }))
        .filter(
          (item): item is { result: PromiseRejectedResult; entry: (typeof entries)[number] } =>
            item.result.status === 'rejected',
        );
      if (failures.length > 0) {
        if (failures.some(({ entry }) => entry.mode?.kind === 'collaboration')) {
          disposedAll = false;
          notify();
          throw new AggregateError(
            failures.map((failure) => failure.result.reason),
            '[DocumentManager] disposeAll failed for one or more documents',
          );
        }

        sidecars.clear();
        hostAdapters.clear();
        documents.clear();
        documentModes.clear();
        documentGenerations.clear();
        loadingStates.clear();
        errors.clear();
        loadingPromises.clear();
        loadingGenerations.clear();
        loadingModes.clear();
        disposeRequestedGenerations.clear();
        notify();
        throw new AggregateError(
          failures.map((failure) => failure.result.reason),
          '[DocumentManager] disposeAll failed for one or more documents',
        );
      }

      sidecars.clear();
      hostAdapters.clear();
      documents.clear();
      documentModes.clear();
      documentGenerations.clear();
      loadingStates.clear();
      errors.clear();
      loadingPromises.clear();
      loadingGenerations.clear();
      loadingModes.clear();
      disposeRequestedGenerations.clear();
      notify();
    },

    getLoadingState(fileId: string): DocumentLoadingState {
      return loadingStates.get(fileId) ?? 'idle';
    },

    getError(fileId: string): Error | null {
      return errors.get(fileId) ?? null;
    },

    getOpenFileIds(): string[] {
      return Array.from(documents.keys());
    },

    subscribe(listener: DocumentManagerListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getState,

    /**
     * Surface a runtime error on an already-loaded doc. Used by the
     * trap-recovery coordinator when a wasm32 trap occurs post-load —
     * the lifecycle machine has the error in its context, but
     * `useDocument` watches the DocumentManager error map, so without
     * this call the UI stays on the (now-stale) handle and never
     * shows the failure.
     */
    setError(fileId: string, error: Error): void {
      setError(fileId, error);
    },

    clearError(fileId: string): void {
      if (!errors.has(fileId)) return;
      errors.delete(fileId);
      // Restore loading state to 'loaded' if the handle is still
      // present (recovery succeeded), or 'idle' if no handle (the
      // doc was already disposed).
      const state: DocumentLoadingState = documents.has(fileId) ? 'loaded' : 'idle';
      loadingStates.set(fileId, state);
      notify();
    },
  };

  // ---------------------------------------------------------------------------
  // Current lifecycle wiring (§6.1, §6.3 cond 1, §9 #5)
  // ---------------------------------------------------------------------------
  //
  // The user-visible spreadsheet doc flow opens documents through this
  // manager (App.tsx → `?doc=<id>` / `?new` / `lastActiveDocId` boot
  // precedence). Until now, those handles never participated in:
  //   - §6.1 unload flush (visibilitychange/pagehide → flushSync)
  //   - §6.3 condition 1 (`hasAppendActive` across active docs)
  //   - §9 #5 per-doc `__dt.persistenceState[docId]`
  // because only `useAppDocument`'s separate `documentCache` was wired.
  //
  // Generalisation (UX-FIX-PRINCIPLES §3): every open spreadsheet doc
  // is a flushSync-eligible doc. We register THIS manager's `documents`
  // map as an additional active-docs provider AND hook the §6.1 listeners
  // through the same `registerLifecycleHooks` entry point — both calls are
  // idempotent across modules, so `useAppDocument` and DocumentManager
  // co-exist without interference.
  const getActiveDocs = (): LifecycleDocumentHandle[] =>
    Array.from(documents.values()) as unknown as LifecycleDocumentHandle[];
  // `registerLifecycleHooks` is idempotent on the listener install AND
  // multi-source on the active-docs registration — every call adds the
  // caller's `getDocs` to the global registry so `useAppDocument`'s
  // documentCache and DocumentManager's documents map both feed the
  // §6.1 unload flush, the §6.3 condition-1 read, and the §9 #5
  // per-doc persistence-state surface.
  registerLifecycleHooks(getActiveDocs);

  return manager;
}
