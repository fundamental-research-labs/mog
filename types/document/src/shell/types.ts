/**
 * Shell-level service contract.
 *
 * `ShellService` is the document-lifecycle facade exposed to action handlers
 * via `ActionDependencies.shellService`. It consolidates the shell's
 * `DocumentManager` (bytes ↔ managed document) and `ProjectService`
 * (open files, active file, save) into a single capability surface that
 * does NOT require handlers to reach into `window.__SHELL__`.
 *
 * The implementation lives in `shell/src/services/shell-service.ts`. The
 * concrete types `DocumentManager` / `ProjectService` are intentionally
 * NOT referenced here — Tier-1 type packages (`@mog-sdk/types-document`) cannot
 * depend on shell internals. The interface describes the capability, not
 * the wiring.
 *
 * This contract lets handlers (file-handlers, charts, etc.) use shell
 * capabilities instead of reaching into `window.__SHELL__`.
 */

import type { PlatformFileHandle } from '../platform/types';

/**
 * Snapshot of document-lifecycle state visible to action handlers.
 *
 * The `handle` field carries the `PlatformFileHandle` last associated with a
 * document so SAVE can write through it without re-prompting. `undefined`
 * means "never had one" (e.g. NEW_WORKBOOK); `null` means "explicitly
 * cleared" (e.g. closeDocument).
 */
export interface ShellDocumentState {
  readonly activeFileId: string | null;
  readonly openFileIds: readonly string[];
  readonly files: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly displayName?: string;
        readonly handle?: PlatformFileHandle | null;
      }
    >
  >;
}

/**
 * Options for {@link ShellService.loadDocument}. The kernel-side document
 * manager already supports `kind` ('xlsx' | 'csv') and an optional
 * `csvOptions.sheetName`; this contract mirrors that surface so handlers
 * can switch on file extension without reaching for `window.__SHELL__`.
 */
export interface LoadDocumentOptions {
  /** Parser selection. Defaults to `'xlsx'` for backwards compatibility. */
  kind?: 'xlsx' | 'csv';
  /** CSV-specific options (used only when `kind === 'csv'`). */
  csvOptions?: {
    sheetName?: string;
  };
}

/**
 * Document-lifecycle capability surface for action handlers.
 *
 * Implementations are constructed once at shell bootstrap and provided via
 * React context (`shell/src/context/shell-service-context.tsx`). Handlers
 * receive an instance through `ActionDependencies.shellService`.
 */
export interface ShellService {
  /**
   * Load bytes as a managed document and make it the active file.
   *
   * Wraps `DocumentManager.loadDocument({type:'bytes', data})` plus the
   * project-service tab/active-file bookkeeping (`addOpenFileId` +
   * `setActiveFileId`) so callers don't have to coordinate the two
   * services manually.
   *
   * @param name - Display name (e.g. file basename); used to seed the tab.
   * @param bytes - File contents (XLSX or CSV based on `options.kind`).
   * @param options - Parser selection / CSV options.
   * @returns The newly-assigned fileId.
   */
  loadDocument(name: string, bytes: Uint8Array, options?: LoadDocumentOptions): Promise<string>;

  /**
   * Create a new empty document. Equivalent of NEW_WORKBOOK.
   * @returns The newly-assigned fileId.
   */
  newDocument(): Promise<string>;

  /**
   * Close the active document and clear its handle. Returns `true` when a
   * document was closed; `false` when there was nothing to close.
   */
  closeActiveDocument(): Promise<boolean>;

  /** Set active document by id. No-op if id is unknown. */
  setActiveDocument(id: string): void;

  /** Read a snapshot of current document state. */
  getDocumentState(): ShellDocumentState;

  /**
   * Persist a file handle on a document so future SAVE writes through it
   * without re-prompting. Pass `null` to explicitly clear.
   */
  setDocumentHandle(fileId: string, handle: PlatformFileHandle | null): void;

  /** Whether the active document (or any document) has unsaved changes. */
  hasUnsavedChanges(): boolean;
}
