/**
 * Project Service
 *
 * Business logic for project folder management.
 * All dependencies are injected - no global state access.
 *
 * This service implements the "smart service, dumb store" pattern:
 * - Store (ProjectSlice): Pure state and setters, no business logic
 * - Service (this file): All business logic, orchestration, IPC calls
 *
 */

import { documentSourceFromBytes } from './document-source';
import type { IPlatform } from '@mog-sdk/contracts/platform';
import type { FileTypeRegistry } from '../../lib/file-type-registry';
import type { ShellStoreApi } from '../../ui-store/shell-store';
import type { DocumentManager } from '../document';
import { ProjectServiceError, type ProjectError } from './errors';
import type { ProjectIpc } from './ipc-types';
import * as treeUtils from './tree-utils';
import type { FileMetadata, ProjectFileEntry } from './types';

// =============================================================================
// Service Types
// =============================================================================

/**
 * Dependencies for creating the project service.
 * All dependencies are injected for testability.
 */
export interface ProjectServiceDeps {
  /**
   * Shell store API for state management.
   */
  store: ShellStoreApi;

  /**
   * Platform abstraction for dialogs, shell operations.
   */
  platform: IPlatform;

  /**
   * IPC interface for file operations.
   */
  ipc: ProjectIpc;

  /**
   * File type registry for extension handling.
   */
  fileTypeRegistry: FileTypeRegistry;

  /**
   * Document manager for document lifecycle.
   * Handles loading, caching, and disposal of documents.
   * ProjectService calls DocumentManager to load/create/dispose documents.
   */
  documentManager: DocumentManager;
}

// =============================================================================
// Service Factory
// =============================================================================

/**
 * Create a project service instance.
 *
 * @param deps - Injected dependencies
 * @returns Project service instance
 *
 * @example
 * ```typescript
 * const service = createProjectService({
 *   store: shellStoreApi,
 *   platform: tauriPlatform,
 *   ipc: tauriIpc,
 *   fileTypeRegistry,
 * });
 *
 * await service.openProject('/path/to/folder');
 * ```
 */
export function createProjectService(deps: ProjectServiceDeps) {
  const { store, platform, ipc, fileTypeRegistry, documentManager } = deps;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getState = () => store.getState();

  // Use crypto.randomUUID with fallback for older environments
  const generateFileId = (): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const getFileName = (path: string): string => path.split(/[/\\]/).pop() || path;

  const getFolderName = (path: string): string => path.split(/[/\\]/).pop() || path;

  const getDirectory = (path: string): string => {
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return lastSlash >= 0 ? path.substring(0, lastSlash) : path;
  };

  const getExtension = (path: string): string => {
    const name = getFileName(path);
    const dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.substring(dotIndex + 1).toLowerCase() : '';
  };

  function throwError(error: ProjectError): never {
    throw new ProjectServiceError(error);
  }

  /**
   * Validate that a path is within the project directory.
   * Prevents path traversal attacks.
   */
  function validatePathInProject(filePath: string): void {
    const { projectPath } = getState();
    if (!projectPath) {
      // No project open, allow operation (for single file mode)
      return;
    }

    // Normalize paths for comparison
    // Handle both forward and back slashes
    const normalizePath = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const normalizedProject = normalizePath(projectPath);
    const normalizedFile = normalizePath(filePath);

    if (!normalizedFile.startsWith(normalizedProject)) {
      throwError({
        type: 'permission_denied',
        path: filePath,
        operation: 'access file outside project',
      });
    }
  }

  // Mutex for serializing save operations
  const saveMutex = {
    locked: false,
    queue: [] as (() => void)[],
    acquire(): Promise<void> {
      return new Promise((resolve) => {
        if (!this.locked) {
          this.locked = true;
          resolve();
        } else {
          this.queue.push(resolve);
        }
      });
    },
    release(): void {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.locked = false;
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Project Operations
  // ---------------------------------------------------------------------------

  /**
   * Open a project folder.
   *
   * @param projectPath - Path to the project folder
   */
  async function openProject(projectPath: string): Promise<void> {
    const state = getState();
    state.setIsLoading(true);

    try {
      // Close existing files
      const fileIds = [...state.openFileIds];
      for (const id of fileIds) {
        await documentManager.disposeDocument(id);
        state.removeFile(id);
        state.removeOpenFileId(id);
      }
      state.setActiveFileId(null);

      // Scan folder
      const fileTree = await ipc.scan_project_folder({
        path: projectPath,
        extensions: fileTypeRegistry.getSupportedExtensions(),
      });

      const projectName = getFolderName(projectPath);
      state.setProject(projectPath, projectName);
      state.setFileTree(fileTree);
      state.setSingleFileMode(false);

      // Update window title
      platform.shell.setWindowTitle(`${projectName} - Spreadsheet OS`);

      // Add to recent projects
      await addRecentProject(projectPath, projectName);

      // Auto-open first spreadsheet
      const firstFile = findFirstSpreadsheet(fileTree);
      if (firstFile) {
        try {
          await openFile(firstFile);
        } catch (err) {
          console.warn('[openProject] Failed to auto-open first file:', err);
        }
      }
    } finally {
      getState().setIsLoading(false);
    }
  }

  /**
   * Open a single file (not a project folder).
   * Sets the parent folder as a minimal project context.
   *
   * @param filePath - Path to the file
   * @returns The file ID
   */
  async function openSingleFile(filePath: string): Promise<string> {
    const state = getState();
    state.setIsLoading(true);

    try {
      await closeProject(true);

      const parentFolder = getDirectory(filePath);
      const fileName = getFileName(filePath);

      state.setProject(parentFolder, fileName);
      state.setFileTree([
        {
          name: fileName,
          path: filePath,
          isDirectory: false,
        },
      ]);
      state.setSingleFileMode(true);

      // Update window title
      platform.shell.setWindowTitle(`${fileName} - Spreadsheet OS`);

      return await openFile(filePath);
    } finally {
      getState().setIsLoading(false);
    }
  }

  /**
   * Close the current project.
   *
   * @param force - If true, close even with unsaved changes
   * @returns true if closed, false if blocked by unsaved changes
   */
  async function closeProject(force?: boolean): Promise<boolean> {
    if (!force && hasUnsavedChanges()) {
      return false;
    }
    const state = getState();
    for (const id of [...state.openFileIds]) {
      await documentManager.disposeDocument(id);
    }
    getState().resetProject();
    platform.shell.setWindowTitle('Spreadsheet OS');
    return true;
  }

  /**
   * Refresh the file tree from disk.
   * Preserves expanded folder state.
   */
  async function refreshFileTree(): Promise<void> {
    const state = getState();
    const { projectPath, fileTree, singleFileMode } = state;

    if (!projectPath || singleFileMode) return;

    const expandedPaths = treeUtils.collectExpandedPaths(fileTree);
    state.setIsLoading(true);

    try {
      const newTree = await ipc.scan_project_folder({
        path: projectPath,
        extensions: fileTypeRegistry.getSupportedExtensions(),
      });

      state.setFileTree(treeUtils.restoreExpandedState(newTree, expandedPaths));
    } finally {
      getState().setIsLoading(false);
    }
  }

  /**
   * Toggle the expanded state of a folder in the file tree.
   *
   * @param folderPath - Path to the folder
   */
  function toggleFolderExpanded(folderPath: string): void {
    const state = getState();
    state.setFileTree(treeUtils.toggleExpanded(state.fileTree, folderPath));
  }

  // ---------------------------------------------------------------------------
  // File Operations
  // ---------------------------------------------------------------------------

  /**
   * Open a file from the project.
   *
   * @param filePath - Path to the file
   * @returns The file ID
   */
  async function openFile(filePath: string): Promise<string> {
    validatePathInProject(filePath);

    const state = getState();

    if (!fileTypeRegistry.isSupported(filePath)) {
      throwError({
        type: 'unsupported_file',
        path: filePath,
        extension: getExtension(filePath),
      });
    }

    // Check if already open
    const existing = Object.values(state.files).find((f) => f.filePath === filePath);
    if (existing) {
      switchToFile(existing.id);
      return existing.id;
    }

    state.setIsLoading(true);

    try {
      const fileId = generateFileId();

      const kind: 'csv' | 'xlsx' = filePath.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
      const data = await ipc.read_file({ path: filePath });
      await documentManager.loadDocument(fileId, documentSourceFromBytes(data), { kind });

      // Update store (metadata only, no bytes)
      const file: FileMetadata = {
        id: fileId,
        filePath,
        displayName: getFileName(filePath),
        isModified: false,
        lastSaved: null,
        documentType: fileTypeRegistry.getDocumentType(filePath),
      };

      state.addFile(file);
      state.addOpenFileId(fileId);
      state.setActiveFileId(fileId);

      // Update window title
      platform.shell.setWindowTitle(`${file.displayName} - Spreadsheet OS`);

      return fileId;
    } finally {
      getState().setIsLoading(false);
    }
  }

  /**
   * Create a new untitled file.
   *
   * @returns The file ID
   */
  async function newFile(): Promise<string> {
    const state = getState();
    const fileId = generateFileId();

    const untitledCount = Object.values(state.files).filter((f) =>
      f.displayName.startsWith('Untitled'),
    ).length;

    const displayName = untitledCount === 0 ? 'Untitled' : `Untitled ${untitledCount + 1}`;

    // Create document via DocumentManager
    await documentManager.createDocument(fileId);

    // Update store (metadata only)
    const file: FileMetadata = {
      id: fileId,
      filePath: null,
      displayName,
      isModified: false,
      lastSaved: null,
      documentType: 'spreadsheet',
    };

    state.addFile(file);
    state.addOpenFileId(fileId);
    state.setActiveFileId(fileId);

    // Update window title
    platform.shell.setWindowTitle(`${displayName} - Spreadsheet OS`);

    return fileId;
  }

  /**
   * Close an open file.
   *
   * @param fileId - The file ID
   * @param force - If true, close even with unsaved changes
   * @returns true if closed, false if blocked by unsaved changes
   */
  async function closeFile(fileId: string, force?: boolean): Promise<boolean> {
    const state = getState();
    const file = state.files[fileId];

    if (!file) return true;
    if (!force && file.isModified) return false;

    const { openFileIds, activeFileId } = state;
    const currentIndex = openFileIds.indexOf(fileId);
    const newIds = openFileIds.filter((id) => id !== fileId);

    // Dispose document via DocumentManager
    await documentManager.disposeDocument(fileId);

    // Determine new active file
    let newActiveId: string | null = null;
    if (activeFileId === fileId && newIds.length > 0) {
      newActiveId = newIds[currentIndex] || newIds[currentIndex - 1] || null;
    } else if (activeFileId !== fileId) {
      newActiveId = activeFileId;
    }

    state.removeFile(fileId);
    state.removeOpenFileId(fileId);
    state.setActiveFileId(newActiveId);

    // Update window title
    if (newActiveId) {
      const currentState = getState(); // Get fresh state
      const newFile = currentState.files[newActiveId];
      if (newFile) {
        platform.shell.setWindowTitle(`${newFile.displayName} - Spreadsheet OS`);
      }
    } else {
      const { projectName } = getState(); // Get fresh state
      platform.shell.setWindowTitle(
        projectName ? `${projectName} - Spreadsheet OS` : 'Spreadsheet OS',
      );
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Switch to a file by ID.
   *
   * @param fileId - The file ID
   */
  function switchToFile(fileId: string): void {
    const state = getState();
    const file = state.files[fileId];
    if (file) {
      state.setActiveFileId(fileId);
      platform.shell.setWindowTitle(`${file.displayName} - Spreadsheet OS`);
    }
  }

  /**
   * Switch to the next open tab.
   */
  function switchToNextTab(): void {
    const { openFileIds, activeFileId } = getState();
    if (!activeFileId || openFileIds.length === 0) return;

    const currentIndex = openFileIds.indexOf(activeFileId);
    const nextIndex = (currentIndex + 1) % openFileIds.length;
    const nextFileId = openFileIds[nextIndex];
    switchToFile(nextFileId);
  }

  /**
   * Switch to the previous open tab.
   */
  function switchToPrevTab(): void {
    const { openFileIds, activeFileId } = getState();
    if (!activeFileId || openFileIds.length === 0) return;

    const currentIndex = openFileIds.indexOf(activeFileId);
    const prevIndex = (currentIndex - 1 + openFileIds.length) % openFileIds.length;
    const prevFileId = openFileIds[prevIndex];
    switchToFile(prevFileId);
  }

  // ---------------------------------------------------------------------------
  // Save Operations
  // ---------------------------------------------------------------------------

  /**
   * Save a file to disk.
   *
   * @param fileId - The file ID
   * @param bytes - The file contents
   * @param savePath - Optional path (for Save As)
   */
  async function saveFile(fileId: string, bytes: Uint8Array, savePath?: string): Promise<void> {
    await saveMutex.acquire();
    try {
      const state = getState();
      const file = state.files[fileId];

      if (!file) {
        throwError({ type: 'file_not_found', path: fileId });
      }

      const targetPath = savePath ?? file.filePath;
      if (!targetPath) {
        throwError({
          type: 'save_failed',
          path: 'unknown',
          reason: 'No path for unsaved file',
        });
      }

      // Validate savePath if provided
      if (savePath) {
        validatePathInProject(savePath);
      }

      await ipc.write_file({
        path: targetPath,
        data: Array.from(bytes),
      });

      const newDisplayName = getFileName(targetPath);
      state.updateFile(fileId, {
        filePath: targetPath,
        displayName: newDisplayName,
        isModified: false,
        lastSaved: new Date(),
      });

      // Update window title
      platform.shell.setWindowTitle(`${newDisplayName} - Spreadsheet OS`);
    } finally {
      saveMutex.release();
    }
  }

  // ---------------------------------------------------------------------------
  // File Tree Operations
  // ---------------------------------------------------------------------------

  /**
   * Rename a file or folder.
   *
   * @param oldPath - Current path
   * @param newName - New name (not full path)
   * @returns The new full path
   */
  async function renameFile(oldPath: string, newName: string): Promise<string> {
    validatePathInProject(oldPath);

    const state = getState();
    const directory = getDirectory(oldPath);
    const newPath = `${directory}/${newName}`;

    await ipc.rename_path({ oldPath, newPath });

    // Update open file if exists
    const openFile = Object.values(state.files).find((f) => f.filePath === oldPath);
    if (openFile) {
      state.updateFile(openFile.id, {
        filePath: newPath,
        displayName: newName,
      });
      if (state.activeFileId === openFile.id) {
        platform.shell.setWindowTitle(`${newName} - Spreadsheet OS`);
      }
    }

    // Update tree
    if (state.singleFileMode) {
      state.setFileTree(
        treeUtils.updateEntry(state.fileTree, oldPath, (entry) => ({
          ...entry,
          name: newName,
          path: newPath,
        })),
      );
    } else {
      await refreshFileTree();
    }

    return newPath;
  }

  /**
   * Delete a file or folder.
   *
   * @param path - Path to delete
   * @param moveToTrash - If true, move to trash instead of permanent delete
   */
  async function deleteFile(path: string, moveToTrash = true): Promise<void> {
    validatePathInProject(path);

    const state = getState();

    // Close any open files at this path (including children for folders)
    const filesToClose = Object.values(state.files).filter(
      (f) => f.filePath === path || f.filePath?.startsWith(path + '/'),
    );
    for (const file of filesToClose) {
      await closeFile(file.id, true);
    }

    await ipc.delete_path({ path, moveToTrash });

    if (state.singleFileMode) {
      state.setFileTree(treeUtils.removeEntry(state.fileTree, path));
    } else {
      await refreshFileTree();
    }
  }

  /**
   * Create a new spreadsheet file in a folder.
   *
   * @param folderPath - Parent folder path
   * @returns The new file path
   */
  async function createSpreadsheetInFolder(folderPath: string): Promise<string> {
    const fullPath = await ipc.generate_unique_filename({
      directory: folderPath,
      baseName: 'Untitled',
      extension: 'xlsx',
    });

    await ipc.create_empty_spreadsheet({ path: fullPath });
    await refreshFileTree();

    return fullPath;
  }

  /**
   * Create a new folder.
   *
   * @param parentPath - Parent folder path
   * @returns The new folder path
   */
  async function createFolder(parentPath: string): Promise<string> {
    const fullPath = await ipc.generate_unique_folder_name({
      directory: parentPath,
      baseName: 'New Folder',
    });

    await ipc.create_folder({ path: fullPath });
    await refreshFileTree();

    return fullPath;
  }

  /**
   * Import files from external paths into the project.
   *
   * @param sourcePaths - Source file paths
   * @param targetDirectory - Target directory in project
   * @returns Array of imported file paths
   */
  async function importFiles(sourcePaths: string[], targetDirectory: string): Promise<string[]> {
    const imported = await ipc.import_files({ sourcePaths, targetDirectory });
    await refreshFileTree();
    return imported;
  }

  // ---------------------------------------------------------------------------
  // Recent Projects
  // ---------------------------------------------------------------------------

  /**
   * Load recent projects from storage.
   */
  async function loadRecentProjects(): Promise<void> {
    const projects = await ipc.get_recent_projects();
    getState().setRecentProjects(projects);
  }

  /**
   * Restore the last opened project on startup.
   * If there's a recent project and no current project is open, re-open it.
   *
   * @returns true if a project was restored, false otherwise
   */
  async function restoreLastProject(): Promise<boolean> {
    // First, load recent projects if not already loaded
    const state = getState();
    if (state.recentProjects.length === 0) {
      await loadRecentProjects();
    }

    // Check if a project is already open
    const { projectPath, recentProjects } = getState();
    if (projectPath) {
      return false;
    }

    // No project open - try to restore the most recent one
    if (recentProjects.length > 0) {
      const lastProject = recentProjects[0]; // Most recent is first

      try {
        // Try to open the project - openProject will fail gracefully
        // if the folder no longer exists (scan_project_folder checks existence)
        await openProject(lastProject.path);
        return true;
      } catch (err) {
        // Folder might have been deleted/moved - log and continue
        console.warn(
          '[ProjectService] Failed to restore last project (folder may no longer exist):',
          err,
        );
      }
    }

    return false;
  }

  /**
   * Add a project to the recent projects list.
   *
   * @param path - Project path
   * @param name - Project name
   */
  async function addRecentProject(path: string, name: string): Promise<void> {
    await ipc.add_recent_project({
      project: { path, name, lastOpened: new Date().toISOString() },
    });
    await loadRecentProjects();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Check if any open file has unsaved changes.
   */
  function hasUnsavedChanges(): boolean {
    return Object.values(getState().files).some((f) => f.isModified);
  }

  /**
   * Get the currently active file metadata.
   */
  function getActiveFile(): FileMetadata | undefined {
    const { activeFileId, files } = getState();
    return activeFileId ? files[activeFileId] : undefined;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Find the first spreadsheet file in a tree.
   * Used for auto-opening when a project is opened.
   */
  function findFirstSpreadsheet(entries: ProjectFileEntry[]): string | null {
    const spreadsheetExtensions = ['xlsx', 'xls', 'csv'];

    // First, check top-level files
    for (const entry of entries) {
      if (!entry.isDirectory) {
        const ext = entry.name.split('.').pop()?.toLowerCase();
        if (ext && spreadsheetExtensions.includes(ext)) {
          return entry.path;
        }
      }
    }

    // Then, recurse into folders
    for (const entry of entries) {
      if (entry.isDirectory && entry.children) {
        const found = findFirstSpreadsheet(entry.children);
        if (found) return found;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    // Project operations
    openProject,
    openSingleFile,
    closeProject,
    refreshFileTree,
    toggleFolderExpanded,

    // File operations
    openFile,
    newFile,
    closeFile,
    saveFile,

    // Navigation
    switchToFile,
    switchToNextTab,
    switchToPrevTab,

    // File tree operations
    renameFile,
    deleteFile,
    createSpreadsheetInFolder,
    createFolder,
    importFiles,

    // Recent projects
    loadRecentProjects,
    addRecentProject,
    restoreLastProject,

    // Queries
    hasUnsavedChanges,
    getActiveFile,
  };
}

// =============================================================================
// Service Type
// =============================================================================

/**
 * Type for the project service instance.
 */
export type ProjectService = ReturnType<typeof createProjectService>;
