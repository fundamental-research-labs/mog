/**
 * FileExplorer - Project file explorer sidebar
 *
 * Displays a tree view of files in the project folder.
 * Similar to VS Code's file explorer.
 *
 * Features:
 * - Tree view of project files (spreadsheets, code, PDFs, images, etc.)
 * - Type-specific icons for different file types
 * - Recursive folder expansion/collapse (click arrow on folder)
 * - Click to open file as tab
 * - Highlight active file
 * - New Spreadsheet and New Folder buttons in toolbar
 * - Collapsible sidebar
 * - Drag and drop files from Finder/Explorer to import them
 *
 * Design tokens used:
 * - bg-ss-surface-secondary for sidebar panel surface
 * - text-ss-text, text-ss-text-secondary for text
 * - bg-ss-surface-tertiary for header background
 * - hover:bg-ss-surface-hover for hover states
 */

import {
  FilePlus,
  FolderOpen,
  FolderPlus,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTauriDropZone } from '../../hooks/use-tauri-drop-zone';
import { cn } from '../ui/radix/styles';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { FileTree, type FileTreeContextMenuProps } from './FileTreeItem';
import type { FileExplorerProps } from './types';

/**
 * FileExplorer component - the project file explorer sidebar.
 */
export function FileExplorer({
  projectName,
  projectPath,
  fileTree,
  activeFilePath,
  onFileClick,
  onToggleFolder,
  onRefresh,
  onCollapse,
  isCollapsed = false,
  // Context menu callbacks
  onRename,
  onDelete,
  onDuplicate,
  onNewSpreadsheet,
  onNewFolder,
  onRevealInFinder,
  onExpandAll,
  onCollapseAll,
  onImportFiles,
  onMoveFile,
}: FileExplorerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle file drops from Tauri
  const handleFileDrop = useCallback(
    (paths: string[]) => {
      if (projectPath && onImportFiles) {
        void onImportFiles(paths, projectPath);
      }
    },
    [projectPath, onImportFiles],
  );

  // Drag-and-drop state for Tauri file drop events
  const isDragOver = useTauriDropZone({
    containerRef,
    onDrop: handleFileDrop,
    disabled: !projectPath || !onImportFiles || isCollapsed,
  });

  // Delete confirmation dialog state (for Cmd+Delete shortcut)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get the active file name for the delete dialog
  const activeFileName = useMemo(() => {
    if (!activeFilePath) return '';
    return activeFilePath.split('/').pop() ?? '';
  }, [activeFilePath]);

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(async () => {
    if (!activeFilePath || !onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(activeFilePath);
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error('[FileExplorer] Delete failed:', error);
      // Parent handles user notification via onDelete rejection
    } finally {
      setIsDeleting(false);
    }
  }, [activeFilePath, onDelete]);

  // Global keyboard shortcut for Cmd+Delete on the active file
  // Works when focus is within the file explorer panel
  useEffect(() => {
    if (!activeFilePath || !onDelete || isCollapsed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Backspace (Mac) or Delete key (without any other modifiers for Delete)
      const isCmdBackspace = e.key === 'Backspace' && e.metaKey && !e.ctrlKey && !e.altKey;
      const isDeleteKey =
        e.key === 'Delete' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

      if (!isCmdBackspace && !isDeleteKey) return;

      // Don't trigger if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Check if focus is within the file explorer
      if (containerRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
        setIsDeleteDialogOpen(true);
      }
    };

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeFilePath, onDelete, isCollapsed]);

  // Handler for creating a root spreadsheet or a no-project untitled workbook.
  const handleNewSpreadsheet = useCallback(() => {
    if (onNewSpreadsheet) {
      void onNewSpreadsheet(projectPath);
    }
  }, [projectPath, onNewSpreadsheet]);

  // Handler for creating new folder at project root
  const handleNewFolder = useCallback(() => {
    if (projectPath && onNewFolder) {
      void onNewFolder(projectPath);
    }
  }, [projectPath, onNewFolder]);

  // Memoize context menu props to avoid unnecessary re-renders
  const contextMenuProps: FileTreeContextMenuProps | undefined = useMemo(() => {
    // Only provide context menu if at least one handler is present
    if (
      !onRename &&
      !onDelete &&
      !onDuplicate &&
      !onNewSpreadsheet &&
      !onRevealInFinder &&
      !onMoveFile
    ) {
      return undefined;
    }
    return {
      projectPath,
      onRename,
      onDelete,
      onDuplicate,
      onNewSpreadsheet,
      onRevealInFinder,
      onExpandAll,
      onCollapseAll,
      onMoveFile,
    };
  }, [
    projectPath,
    onRename,
    onDelete,
    onDuplicate,
    onNewSpreadsheet,
    onRevealInFinder,
    onExpandAll,
    onCollapseAll,
    onMoveFile,
  ]);

  // Focus the container when clicking within it (for keyboard shortcuts)
  // Note: Defined before early return to satisfy React hooks rules
  const handleContainerClick = useCallback(() => {
    containerRef.current?.focus();
  }, []);

  // When collapsed, show a minimal sidebar with just the expand button
  if (isCollapsed) {
    return (
      <div className="bg-ss-surface-secondary flex h-full w-full flex-col">
        {/* Drag region for window */}
        <div data-tauri-drag-region className="h-8 w-full shrink-0" aria-hidden="true" />

        {/* Expand button */}
        <button
          onClick={onCollapse}
          className="text-ss-text hover:bg-ss-surface-hover mx-auto mt-2 flex h-8 w-8 items-center justify-center rounded-md transition-colors"
          title="Expand file explorer"
          aria-label="Expand file explorer"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onClick={handleContainerClick}
      className={cn(
        'text-ss-text bg-ss-surface-secondary relative flex h-full w-full min-w-[180px] flex-col outline-none',
        isDragOver && 'ring-ss-primary ring-2 ring-inset',
      )}
    >
      {/* Drop overlay when dragging files */}
      {isDragOver && (
        <div className="bg-ss-primary/10 pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center">
          <Upload className="text-ss-primary h-10 w-10" />
          <p className="text-ss-primary mt-2 text-sm font-medium">Drop files to import</p>
        </div>
      )}

      {/* Action bar - replaces empty drag region with useful buttons */}
      <div
        data-tauri-drag-region
        className="flex h-8 w-full shrink-0 items-center justify-between px-2"
      >
        {/* Left side: action buttons */}
        <div className="flex items-center gap-1">
          {onNewSpreadsheet && (
            <button
              onClick={handleNewSpreadsheet}
              className="text-ss-text-secondary hover:text-ss-text hover:bg-ss-surface-hover flex h-6 items-center gap-1 rounded px-1.5 text-xs transition-colors"
              title="New Spreadsheet"
              aria-label="New Spreadsheet"
            >
              <FilePlus className="h-3.5 w-3.5" />
              <span>File</span>
            </button>
          )}
          {onNewFolder && (
            <button
              onClick={handleNewFolder}
              className="text-ss-text-secondary hover:text-ss-text hover:bg-ss-surface-hover flex h-6 items-center gap-1 rounded px-1.5 text-xs transition-colors"
              title="New Folder"
              aria-label="New Folder"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>Folder</span>
            </button>
          )}
        </div>

        {/* Right side: refresh and panel collapse */}
        <div className="flex items-center">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-ss-text-secondary hover:text-ss-text hover:bg-ss-surface-hover flex h-6 w-6 items-center justify-center rounded transition-colors"
              title="Refresh file list"
              aria-label="Refresh file list"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="text-ss-text-secondary hover:text-ss-text hover:bg-ss-surface-hover flex h-6 w-6 items-center justify-center rounded transition-colors"
              title="Collapse file explorer"
              aria-label="Collapse file explorer"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Header with workspace name */}
      <div className="bg-ss-surface-tertiary flex items-center px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center">
          <span
            className="text-ss-text max-w-[160px] truncate text-xs font-medium"
            title={projectName ? `Workspace: ${projectName}` : 'Workspace'}
          >
            {projectName ? `Workspace: ${projectName}` : 'Workspace'}
          </span>
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto">
        {projectName ? (
          <FileTree
            entries={fileTree}
            activeFilePath={activeFilePath}
            onFileClick={onFileClick}
            onToggleFolder={onToggleFolder}
            contextMenuProps={contextMenuProps}
          />
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <FolderOpen className="text-ss-text-secondary h-10 w-10" />
            <p className="text-ss-text-secondary mt-3 text-sm">No project open</p>
            <p className="text-ss-text-tertiary mt-1 text-xs">Open a folder to view files</p>
          </div>
        )}
      </div>

      {/* Footer with file count */}
      {projectName && fileTree.length > 0 && (
        <div className="px-3 py-1.5">
          <p className="text-ss-text-tertiary text-xs">
            {countFiles(fileTree)} file{countFiles(fileTree) !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* Delete confirmation dialog (for Cmd+Delete shortcut on active file) */}
      <DeleteConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        name={activeFileName}
        isDirectory={false}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </div>
  );
}

/**
 * Count total files (non-directories) in the tree recursively.
 */
function countFiles(entries: FileExplorerProps['fileTree']): number {
  return entries.reduce((count, entry) => {
    if (entry.isDirectory) {
      return count + (entry.children ? countFiles(entry.children) : 0);
    }
    return count + 1;
  }, 0);
}

export default FileExplorer;
