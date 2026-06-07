/**
 * Document Manager Types
 *
 * Types for the DocumentManager service that manages document lifecycle
 * at the shell level, surviving React component remounts.
 *
 */

import type { CsvImportOptions } from '@mog-sdk/contracts/document';
import type { DocumentHandle } from '@mog-sdk/kernel';
import type { WorkbookLinkResolver } from '@mog-sdk/kernel';

/**
 * Loading state for a document.
 * - 'idle': No loading has been initiated
 * - 'loading': Document is currently being loaded/created
 * - 'loaded': Document is ready to use
 * - 'error': Loading failed, check getError() for details
 */
export type DocumentLoadingState = 'idle' | 'loading' | 'loaded' | 'error';

export interface DocumentRuntimeAssetOptions {
  readonly wasmBaseUrl?: string;
  readonly workerUrl?: string;
  readonly staticAssetBase?: string;
}

export interface DocumentManagerOptions {
  readonly runtimeAssets?: DocumentRuntimeAssetOptions;
}

/**
 * Internal state of the DocumentManager.
 * Used by subscribers to react to state changes.
 */
export interface DocumentManagerState {
  /** Map of fileId to loaded document handle */
  documents: ReadonlyMap<string, DocumentHandle>;
  /** Map of fileId to document mode metadata. */
  documentModes: ReadonlyMap<string, ShellDocumentMode>;
  /** Map of fileId to loading state */
  loadingStates: ReadonlyMap<string, DocumentLoadingState>;
  /** Map of fileId to error (if state is 'error') */
  errors: ReadonlyMap<string, Error>;
}

export type ShellDocumentMode =
  | {
      readonly kind: 'normal';
      readonly documentId: string;
      readonly skipLocalPersistence: boolean;
    }
  | {
      readonly kind: 'collaboration';
      readonly documentId: string;
      readonly roomId: string;
      readonly roomUrl: string;
      readonly participantId: string;
      readonly bootstrapRoomEpoch: number;
      readonly bootstrapFullStateHash: string;
      readonly bootstrapSnapshotToken: string;
    };

export interface CreateCollaborationDocumentOptions {
  readonly documentId: string;
  readonly baseUrl: string;
  readonly roomId: string;
  readonly participantId: string;
  readonly timeouts?: {
    readonly snapshotMs?: number;
    readonly joinMs?: number;
    readonly finalFlushMs?: number;
  };
}

/**
 * Options for creating a new document.
 */
export interface CreateDocumentOptions {
  /** Optional document ID (for URL persistence via hash) */
  documentId?: string;
  /** Session operation for host authorization. Defaults to 'create'. */
  operation?: 'create' | 'open';
  /**
   * When true, create the document without a local default Sheet1.
   *
   * This is required for invite-link collaboration joins: the room's CRDT
   * state is the authoritative workbook, and pre-creating a local sheet
   * introduces independent Yrs identities that can mask hydrated data.
   */
  skipDefaultSheet?: boolean;
  /**
   * Mark this document as internal / non-user-visible.
   *
   * When `true`, the orchestrator skips `touchDoc(docId)` so the doc
   * never appears in the Meta API's `recentDocs` or `lastActiveDocId`.
   * This is the Current §6.2 path-(b) escape hatch for internal scaffold
   * docs (e.g., the `os-fallback-doc` the shell historically opens at
   * boot for non-document AppKernelAPI consumers).
   *
   * Default: `false` (user-visible, tracked by meta).
   *
   */
  internal?: boolean;
  /** Trusted host/runtime resolver for cross-workbook links. */
  workbookLinkResolver?: WorkbookLinkResolver;

  /**
   * Skip local persistence (IndexedDB, Web Locks). The storage handoff uses
   * `durability: 'ephemeral'` with no providers. Use when the host owns
   * persistence (e.g., `persistenceMode: 'host-owned-ephemeral'`).
   */
  skipLocalPersistence?: boolean;
}

/**
 * Options for loading a document from a file source.
 */
export interface LoadDocumentOptions {
  /**
   * File format. Determines which DocumentFactory entry point is used.
   *   - 'xlsx' (default): internal host-backed interactive XLSX import for
   *     browser first paint.
   *   - 'csv': `DocumentFactory.createFromCsv` — UTF-8 text path with BOM
   *     stripping, replacement-char tolerance, and binary-blob rejection.
   *
   * Default is 'xlsx' so existing call sites that don't pass `options`
   * keep working.
   */
  kind?: 'xlsx' | 'csv';

  /** CSV-specific options. Ignored unless `kind === 'csv'`. */
  csvOptions?: CsvImportOptions;

  /**
   * Skip local persistence (IndexedDB, Web Locks). The storage handoff uses
   * `durability: 'ephemeral'` with no providers. Use when the host owns
   * persistence (e.g., `persistenceMode: 'host-owned-ephemeral'`).
   */
  skipLocalPersistence?: boolean;
}

/**
 * Listener function type for subscriptions.
 * Called whenever the DocumentManager state changes.
 */
export type DocumentManagerListener = (state: DocumentManagerState) => void;

/**
 * Unsubscribe function returned by subscribe().
 * Call this to stop receiving state change notifications.
 */
export type Unsubscribe = () => void;
