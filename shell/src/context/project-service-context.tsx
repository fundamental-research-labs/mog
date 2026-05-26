/**
 * Project Service Context
 *
 * Provides the project service to React components via context.
 * The project service manages:
 * - Opening/closing projects (folders)
 * - Opening/closing files
 * - File tree navigation
 * - Save operations
 * - Recent projects
 *
 * Architecture:
 * - Uses dependency injection (store, platform, ipc, fileTypeRegistry)
 * - Service is created once and memoized
 * - Components access via useProjectService() hook
 *
 * @example
 * ```tsx
 * // Setup at app root (inside ShellProvider and PlatformProvider)
 * <ProjectServiceProvider>
 *   <ShellHost ... />
 * </ProjectServiceProvider>
 *
 * // Usage in components
 * const projectService = useProjectService();
 * await projectService.openProject('/path/to/folder');
 * ```
 *
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { fileTypeRegistry } from '../lib/file-type-registry';
import { createDocumentManager, type DocumentManager } from '../services/document';
import { createProjectService, type ProjectIpc, type ProjectService } from '../services/project';
import { createTauriIpc } from '../services/project/tauri-ipc';
import { usePlatform } from './platform-context';
import { useShellStoreApi } from './shell-store-context';

// =============================================================================
// Context
// =============================================================================

const ProjectServiceContext = createContext<ProjectService | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface ProjectServiceProviderProps {
  /**
   * Children to render.
   */
  children: ReactNode;

  /**
   * Pre-created project service from bootstrap (PREFERRED).
   * If provided, uses this service instead of creating one.
   */
  projectService?: ProjectService | null;

  /**
   * Optional IPC implementation override.
   * Useful for testing with mock IPC.
   * Only used if projectService is not provided.
   *
   * @default createTauriIpc() (Tauri IPC)
   */
  ipc?: ProjectIpc;

  /**
   * Document manager for document lifecycle.
   * Only used if projectService is not provided (legacy pattern).
   * If not provided in legacy pattern, a new DocumentManager is created internally.
   *
   * Note: When using shell bootstrap (recommended), the documentManager is
   * already injected into the pre-created projectService.
   */
  documentManager?: DocumentManager;
}

/**
 * Provider component that provides the project service.
 *
 * NEW PATTERN (recommended):
 * - Pass `projectService` from createShell() bootstrap
 * - Service is created before React mounts
 *
 * LEGACY PATTERN (backwards compatible):
 * - Don't pass projectService
 * - Service is created inside this component
 *
 * @example
 * ```tsx
 * // NEW PATTERN (from shell bootstrap)
 * const shell = await createShell();
 * <ProjectServiceProvider projectService={shell.projectService}>
 *   <App />
 * </ProjectServiceProvider>
 *
 * // LEGACY PATTERN (creates service internally)
 * <ProjectServiceProvider>
 *   <App />
 * </ProjectServiceProvider>
 *
 * // Testing with mock IPC
 * const mockIpc = createMockIpc();
 * <ProjectServiceProvider ipc={mockIpc}>
 *   <TestComponent />
 * </ProjectServiceProvider>
 * ```
 */
export function ProjectServiceProvider({
  children,
  projectService,
  ipc,
  documentManager,
}: ProjectServiceProviderProps): React.JSX.Element {
  const storeApi = useShellStoreApi();
  const platform = usePlatform();

  // Use pre-created service or create one
  const service = useMemo(() => {
    // If pre-created service is provided, use it
    if (projectService !== undefined) {
      return projectService;
    }
    // Otherwise, create the service (legacy pattern)
    // Note: In legacy pattern, create a DocumentManager if not provided.
    // This is not ideal but maintains backwards compatibility.
    // TODO: Once all callers pass documentManager, remove this fallback.
    const dm = documentManager ?? createDocumentManager();
    return createProjectService({
      store: storeApi,
      platform,
      ipc: ipc ?? createTauriIpc(),
      fileTypeRegistry,
      documentManager: dm,
    });
  }, [projectService, storeApi, platform, ipc, documentManager]);

  return (
    <ProjectServiceContext.Provider value={service}>{children}</ProjectServiceContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access the project service.
 *
 * @returns The ProjectService instance
 * @throws Error if used outside of ProjectServiceProvider
 *
 * @example
 * ```tsx
 * function OpenProjectButton() {
 *   const projectService = useProjectService();
 *   const platform = usePlatform();
 *
 *   const handleOpenProject = async () => {
 *     const path = await platform.dialogs.showOpenFolderDialog();
 *     if (path) {
 *       await projectService.openProject(path);
 *     }
 *   };
 *
 *   return <button onClick={handleOpenProject}>Open Project</button>;
 * }
 * ```
 */
export function useProjectService(): ProjectService {
  const service = useContext(ProjectServiceContext);
  if (!service) {
    throw new Error('useProjectService must be used within ProjectServiceProvider');
  }
  return service;
}

// =============================================================================
// Optional Hook
// =============================================================================

/**
 * Hook to optionally access the project service.
 * Returns null if not within a ProjectServiceProvider.
 *
 * Useful for components that can work with or without project functionality.
 *
 * @returns The ProjectService instance or null
 */
export function useProjectServiceOptional(): ProjectService | null {
  return useContext(ProjectServiceContext);
}
