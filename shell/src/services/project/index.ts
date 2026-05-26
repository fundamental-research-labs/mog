/**
 * Project Service Barrel Export
 *
 * Provides project folder management functionality:
 * - Types: ProjectFileEntry, FileMetadata, DocumentType, RecentProject
 * - Errors: ProjectError, ProjectServiceError, isProjectError
 * - IPC: ProjectIpc interface for Tauri commands
 * - Tree Utils: Pure functions for tree manipulation
 * - Service: createProjectService factory with dependency injection
 */

// Core types
export * from './types';

// Error handling
export * from './errors';

// IPC contracts
export type { ProjectIpc } from './ipc-types';

// Tree manipulation utilities (pure functions)
export {
  collectExpandedPaths,
  findAllFiles,
  findAllFolders,
  findEntry,
  flattenEntries,
  insertEntry,
  removeEntry,
  restoreExpandedState,
  sortEntries,
  toggleExpanded,
  updateEntry,
} from './tree-utils';

// Project service (business logic layer)
export {
  createProjectService,
  type ProjectService,
  type ProjectServiceDeps,
} from './project-service';

// IPC implementations
export { createMockFileSystem, createMockIpc, type MockFileSystem } from './mock-ipc';
export { createTauriIpc } from './tauri-ipc';
