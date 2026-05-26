/**
 * DocumentManager Interface
 *
 * Manages document lifecycle at the shell level.
 * Documents survive React component remounts because this service
 * holds them in Maps outside of React's component tree.
 *
 * Key design decisions:
 * 1. Services own lifecycle, components subscribe
 * 2. Deduplication via loading promise - concurrent requests share promise
 * 3. State survives remounts - service uses Map, not useState
 *
 */

import type { CollaborationSidecar, DocumentHandle } from '@mog-sdk/kernel';
import type { DocumentSource } from '@mog-sdk/contracts/document';
import type {
  CreateDocumentOptions,
  CreateCollaborationDocumentOptions,
  DocumentLoadingState,
  DocumentManagerListener,
  DocumentManagerState,
  LoadDocumentOptions,
  ShellDocumentMode,
  Unsubscribe,
} from './types';

/**
 * DocumentManager interface for managing document lifecycle.
 *
 * Created during shell bootstrap (before React mounts) and provided
 * to React via context. The DocumentManager is a singleton per shell instance.
 */
export interface DocumentManager {
  // -------------------------------------------------------------------------
  // Document Operations
  // -------------------------------------------------------------------------

  /**
   * Load a document from a file source. Supports XLSX and CSV formats.
   *
   * **Deduplication**: If already loading, returns existing promise.
   * **Caching**: If already loaded, returns cached handle.
   *
   * @param fileId - Unique file identifier (from ProjectService)
   * @param source - Document source (file path on desktop, bytes on web/recovery)
   * @param options - Optional load configuration. `kind` selects the parser
   *                  (defaults to `'xlsx'` for backwards compatibility — the
   *                  predominant load path before CSV support landed).
   * @returns Promise resolving to document handle
   *
   * @example
   * ```typescript
   * // XLSX (default)
   * const handle = await documentManager.loadDocument(fileId, { type: 'path', path: '/foo.xlsx' });
   *
   * // CSV — caller signals format via `kind`
   * const handle = await documentManager.loadDocument(fileId, { type: 'bytes', data }, { kind: 'csv' });
   * ```
   */
  loadDocument(
    fileId: string,
    source: DocumentSource,
    options?: LoadDocumentOptions,
  ): Promise<DocumentHandle>;

  /**
   * Create a new blank document.
   *
   * **Deduplication**: If already loading/creating, returns existing promise.
   * **Caching**: If already created, returns cached handle.
   *
   * @param fileId - Unique file identifier
   * @param options - Optional creation options (documentId for URL persistence)
   * @returns Promise resolving to document handle
   */
  createDocument(fileId: string, options?: CreateDocumentOptions): Promise<DocumentHandle>;

  createCollaborationDocument(
    fileId: string,
    options: CreateCollaborationDocumentOptions,
  ): Promise<DocumentHandle>;

  /**
   * Get a loaded document by file ID.
   * Returns null if not loaded or still loading.
   *
   * This is the primary method for React hooks to access documents
   * after they've been loaded by ProjectService.
   */
  getDocument(fileId: string): DocumentHandle | null;

  /**
   * Dispose a document and release its resources.
   * Called when a file is closed.
   *
   * Safe to call even if document doesn't exist.
   */
  disposeDocument(fileId: string): Promise<void>;

  closeCollaborationDocument(
    fileId: string,
    options?: { readonly timeoutMs?: number },
  ): Promise<void>;

  /**
   * Get the collab sidecar for a document (if collab is active).
   * Returns null if no sidecar is attached.
   */
  getSidecar(fileId: string): CollaborationSidecar | null;

  getDocumentMode(fileId: string): ShellDocumentMode | null;

  /**
   * Attach a collab WS sidecar to an already-loaded document.
   *
   * - Throws if `fileId` has no loaded document.
   * - Idempotent: if a sidecar already exists for `fileId`, detaches it first.
   * - After this call, `getSidecar(fileId)` returns the new sidecar.
   */
  attachSidecar(
    fileId: string,
    config: { url: string; roomId: string; participantId: string },
  ): Promise<void>;

  /**
   * Detach and disconnect the collab sidecar for a document.
   * No-op if no sidecar is attached.
   */
  detachSidecar(fileId: string): void;

  /**
   * Dispose all documents.
   * Called on shell shutdown.
   */
  disposeAll(): Promise<void>;

  // -------------------------------------------------------------------------
  // State Queries
  // -------------------------------------------------------------------------

  /**
   * Get the loading state for a file.
   * Returns 'idle' if no operation has been initiated for this file.
   */
  getLoadingState(fileId: string): DocumentLoadingState;

  /**
   * Get the error for a file (if state is 'error').
   * Returns null if no error.
   */
  getError(fileId: string): Error | null;

  /**
   * Get all open file IDs.
   * Returns array of fileIds that have loaded documents.
   */
  getOpenFileIds(): string[];

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  /**
   * Subscribe to state changes.
   * Used by React hooks to trigger re-renders when documents change.
   *
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = documentManager.subscribe((state) => {
   *   console.log('Documents changed:', state.documents.size);
   * });
   *
   * // Later:
   * unsubscribe();
   * ```
   */
  subscribe(listener: DocumentManagerListener): Unsubscribe;

  /**
   * Get current state snapshot.
   * Useful for initial render before subscribing.
   */
  getState(): DocumentManagerState;

  /**
   * Surface a runtime error against an already-loaded doc so the
   * `useDocument` hook re-renders with the error UI.
   *
   * Used by the trap-recovery coordinator
   * (`shell/src/services/trap-recovery/`) when a wasm32 trap occurs
   * AFTER the doc has finished loading: the lifecycle machine
   * transitions to `error` internally, but the DocumentManager's
   * error map (which `useDocument` watches) is only populated by the
   * load path. This method bridges the gap.
   *
   * Idempotent: calling twice with the same fileId+error is a no-op
   * (DocumentManagerListener fires once because Map.set is set-or-
   * replace).
   *
   * Does NOT dispose the handle — the recovery coordinator may still
   * call `handle._trapRecovery.recover()` to bring the doc back, at
   * which point {@link clearError} should be invoked.
   */
  setError(fileId: string, error: Error): void;

  /**
   * Clear the error for a fileId (e.g. after a successful trap-
   * recovery cycle), and reset the loading state to `'loaded'` so
   * `useDocument` returns the (now-recovered) handle.
   *
   * No-op if the fileId has no recorded error.
   */
  clearError(fileId: string): void;
}
