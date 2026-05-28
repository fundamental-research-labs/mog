/**
 * useFileExplorerConfig - Hook to create FileExplorer props from project service
 *
 * This hook connects the project service, shell store, and platform to create
 * the complete FileExplorerConfig for the ShellHost component.
 *
 * @example
 * ```tsx
 * function App() {
 *   const fileExplorerConfig = useFileExplorerConfig();
 *   return (
 *     <ShellHost
 *       kernel={kernel}
 *       fileExplorer={fileExplorerConfig}
 *     />
 *   );
 * }
 * ```
 */

import { useCallback, useMemo } from 'react';
import { useShellStore } from '../context';
import { usePlatformOptional } from '../context/platform-context';
import { useProjectServiceOptional } from '../context/project-service-context';
import type { FileExplorerConfig } from '../host/ShellHost';

/**
 * Options for the useFileExplorerConfig hook.
 */
export interface UseFileExplorerConfigOptions {
  /**
   * Whether to enable the file explorer.
   * If false, returns undefined.
   * @default true
   */
  enabled?: boolean;
}

/**
 * Hook to create FileExplorer configuration from project service.
 *
 * Must be used within:
 * - ShellStoreContext (for store access)
 * - PlatformProvider (for platform access)
 * - ProjectServiceProvider (for project service access)
 *
 * @param options - Configuration options
 * @returns FileExplorerConfig or undefined if not enabled/available
 */
export function useFileExplorerConfig(
  options: UseFileExplorerConfigOptions = {},
): FileExplorerConfig | undefined {
  const { enabled = true } = options;

  // Get state from shell store
  const projectPath = useShellStore((s) => s.projectPath);
  const projectName = useShellStore((s) => s.projectName);
  const fileTree = useShellStore((s) => s.fileTree);
  const activeFileId = useShellStore((s) => s.activeFileId);
  const files = useShellStore((s) => s.files);

  // Get services (optional to allow graceful degradation)
  const projectService = useProjectServiceOptional();
  const platform = usePlatformOptional();

  // Compute active file path
  const activeFilePath = useMemo(() => {
    if (!activeFileId) return null;
    return files[activeFileId]?.filePath ?? null;
  }, [activeFileId, files]);

  // File click handler - opens file in project service
  const handleFileClick = useCallback(
    (path: string) => {
      if (projectService) {
        void projectService.openFile(path);
      }
    },
    [projectService],
  );

  // Toggle folder handler
  const handleToggleFolder = useCallback(
    (path: string) => {
      if (projectService) {
        projectService.toggleFolderExpanded(path);
      }
    },
    [projectService],
  );

  // Refresh handler
  const handleRefresh = useCallback(() => {
    if (projectService) {
      void projectService.refreshFileTree();
    }
  }, [projectService]);

  // Rename handler
  const handleRename = useCallback(
    async (path: string, newName: string) => {
      if (projectService) {
        await projectService.renameFile(path, newName);
      }
    },
    [projectService],
  );

  // Delete handler
  const handleDelete = useCallback(
    async (path: string) => {
      if (projectService) {
        await projectService.deleteFile(path);
      }
    },
    [projectService],
  );

  // New spreadsheet handler
  const handleNewSpreadsheet = useCallback(
    async (folderPath: string | null) => {
      if (projectService) {
        if (folderPath === null) {
          await projectService.newFile();
          return;
        }

        const newPath = await projectService.createSpreadsheetInFolder(folderPath);
        // Auto-open the new file
        await projectService.openFile(newPath);
      }
    },
    [projectService],
  );

  // New folder handler
  const handleNewFolder = useCallback(
    async (parentPath: string) => {
      if (projectService) {
        await projectService.createFolder(parentPath);
      }
    },
    [projectService],
  );

  // Reveal in finder handler
  const handleRevealInFinder = useCallback(
    async (path: string) => {
      if (platform) {
        await platform.shell.revealInFileManager(path);
      }
    },
    [platform],
  );

  // Import files handler (for drag-and-drop)
  const handleImportFiles = useCallback(
    async (sourcePaths: string[], targetDirectory: string) => {
      if (projectService) {
        await projectService.importFiles(sourcePaths, targetDirectory);
      }
    },
    [projectService],
  );

  // Build config if enabled and service is available
  return useMemo<FileExplorerConfig | undefined>(() => {
    if (!enabled || !projectService) {
      return undefined;
    }

    return {
      projectName,
      projectPath,
      fileTree,
      activeFilePath,
      onFileClick: handleFileClick,
      onToggleFolder: handleToggleFolder,
      onRefresh: handleRefresh,
      onRename: handleRename,
      onDelete: handleDelete,
      onNewSpreadsheet: handleNewSpreadsheet,
      onNewFolder: handleNewFolder,
      onRevealInFinder: platform ? handleRevealInFinder : undefined,
      onImportFiles: handleImportFiles,
    };
  }, [
    enabled,
    projectService,
    projectName,
    projectPath,
    fileTree,
    activeFilePath,
    handleFileClick,
    handleToggleFolder,
    handleRefresh,
    handleRename,
    handleDelete,
    handleNewSpreadsheet,
    handleNewFolder,
    platform,
    handleRevealInFinder,
    handleImportFiles,
  ]);
}

/**
 * Hook to open a project folder via dialog.
 *
 * @returns Handler function to trigger folder selection dialog
 */
export function useOpenProjectDialog(): (() => Promise<void>) | null {
  const projectService = useProjectServiceOptional();
  const platform = usePlatformOptional();

  return useMemo(() => {
    if (!projectService || !platform) {
      return null;
    }

    return async () => {
      const folder = await platform.dialogs.showOpenFolderDialog();
      if (folder) {
        await projectService.openProject(folder);
      }
    };
  }, [projectService, platform]);
}
