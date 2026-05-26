/**
 * Shell Service — document-lifecycle facade for action handlers.
 *
 * The shell-service facade introduces this layer to eliminate the
 * `window.__SHELL__` documentManager / projectService
 * reach-arounds that file/object handlers in `apps/spreadsheet/` use today.
 *
 * The shell already exposes two services that, together, cover the needed
 * surface:
 *
 * - `DocumentManager` (`./document/document-manager.ts`): bytes ↔ managed
 *   document via `loadDocument(fileId, source, options)` /
 *   `createDocument(fileId, options)` / `disposeDocument(fileId)`.
 * - `ProjectService` (`./project/project-service.ts`): tab-strip lifecycle
 *   (`newFile`, `closeFile`, `switchToFile`, `getActiveFile`,
 *   `hasUnsavedChanges`, etc.).
 *
 * `createShellService()` wires them together and adds:
 *
 * - A higher-level `loadDocument(name, bytes, options)` that does what
 *   `triggerWebFilePicker` (file-handlers.ts) used to do inline: call
 *   `documentManager.loadDocument({type:'bytes', data})` and update the
 *   tab strip via the project store. The fileId is generated here so the
 *   caller doesn't need to invent one.
 * - `setDocumentHandle(fileId, handle)` so SAVE can write through a stored
 *   `PlatformFileHandle` without re-prompting the user. The handle is held
 *   in an in-memory map keyed by fileId; the shell project store keeps
 *   `FileMetadata` (id/displayName/isModified) exactly as before.
 *
 */

import type { PlatformFileHandle } from '@mog-sdk/contracts/platform';
import type {
  LoadDocumentOptions,
  ShellDocumentState,
  ShellService,
} from '@mog-sdk/types-document/shell/types';
import type { ShellStoreApi } from '../ui-store/shell-store';
import type { DocumentManager } from './document';
import type { ProjectService } from './project/project-service';

export interface ShellServiceDeps {
  documentManager: DocumentManager;
  projectService: ProjectService;
  store: ShellStoreApi;
}

/**
 * Create a `ShellService` instance from the existing shell services.
 *
 * The resulting object is a thin orchestration layer — it does not own
 * state directly except for the in-memory `PlatformFileHandle` map (whose
 * lifetime is tied to the shell instance). All file metadata still lives
 * on the project store; document lifecycle still goes through
 * `DocumentManager`.
 */
export function createShellService(deps: ShellServiceDeps): ShellService {
  const { documentManager, projectService, store } = deps;

  /**
   * In-memory `fileId → PlatformFileHandle` map. Not persisted; cleared
   * implicitly when a doc is closed (we drop the entry in
   * `closeActiveDocument`). The shell store's `FileMetadata` already
   * carries `filePath` for desktop-native paths; the handle is the *live*
   * object you can `.write()` through (FSA / Tauri / anchor-download).
   */
  const handles = new Map<string, PlatformFileHandle>();

  // Use crypto.randomUUID with fallback for older environments. Mirrors
  // `project-service.ts:generateFileId()` so externally-generated IDs
  // (FileExplorer drag-drop) and shell-service-generated IDs collide-free.
  function generateFileId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  return {
    async loadDocument(
      name: string,
      bytes: Uint8Array,
      options?: LoadDocumentOptions,
    ): Promise<string> {
      const fileId = generateFileId();
      const lower = name.toLowerCase();
      const inferredKind: 'xlsx' | 'csv' = lower.endsWith('.csv') ? 'csv' : 'xlsx';
      const kind = options?.kind ?? inferredKind;
      const stem = name.replace(/\.[^.]+$/, '');

      // Hand bytes to the shell document manager for parsing/hydration.
      await documentManager.loadDocument(
        fileId,
        { type: 'bytes', data: bytes },
        {
          kind,
          csvOptions:
            kind === 'csv' ? { sheetName: options?.csvOptions?.sheetName ?? stem } : undefined,
        },
      );

      // Register on the project store so the tab strip updates and the
      // tab becomes active. Mirrors the trail used by FileExplorer
      // drag-drop / startup-load (apps/spreadsheet/src/index.tsx:367).
      const state = store.getState();
      state.addFile({
        id: fileId,
        filePath: null,
        displayName: stem || name,
        isModified: false,
        lastSaved: null,
        documentType: 'spreadsheet',
      });
      state.addOpenFileId(fileId);
      state.setActiveFileId(fileId);

      return fileId;
    },

    async newDocument(): Promise<string> {
      // Defer entirely to the project service which already implements the
      // "new untitled file + name dedup + window title + activate" flow.
      return projectService.newFile();
    },

    async closeActiveDocument(): Promise<boolean> {
      const active = projectService.getActiveFile();
      if (!active) return false;
      // `force=true` because the SAVE-on-close prompt is a UI concern of
      // the action handler, not the shell service. Action handlers will
      // gate on `hasUnsavedChanges()` themselves.
      const closed = await projectService.closeFile(active.id, true);
      if (closed) handles.delete(active.id);
      return closed;
    },

    setActiveDocument(id: string): void {
      projectService.switchToFile(id);
    },

    getDocumentState(): ShellDocumentState {
      const state = store.getState();
      const files: Record<
        string,
        { id: string; displayName?: string; handle?: PlatformFileHandle | null }
      > = {};
      for (const [id, meta] of Object.entries(state.files)) {
        files[id] = {
          id,
          displayName: meta.displayName,
          handle: handles.get(id) ?? null,
        };
      }
      return {
        activeFileId: state.activeFileId,
        openFileIds: state.openFileIds,
        files,
      };
    },

    setDocumentHandle(fileId: string, handle: PlatformFileHandle | null): void {
      if (handle === null) {
        handles.delete(fileId);
      } else {
        handles.set(fileId, handle);
      }
    },

    hasUnsavedChanges(): boolean {
      return projectService.hasUnsavedChanges();
    },
  };
}
