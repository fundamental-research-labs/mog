/**
 * FileTreeItem - Recursive tree item for the file explorer
 *
 * Renders a single file or folder in the project file tree.
 * Folders can be expanded/collapsed to show their children.
 * Supports context menu for file operations (rename, delete, etc.)
 *
 * Design tokens used:
 * - text-ss-text for text color
 * - bg-ss-primary-light + border-l-ss-primary for selected state (prominent blue tint + left indicator)
 * - hover:bg-ss-surface-hover for hover state
 */

import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../ui/radix/styles';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { FileIcon, VscFile, getNameWithoutExtension } from './file-icons';
import { FileContextMenu } from './FileContextMenu';
import type { FileTreeItemProps, ProjectFileEntry } from './types';

/** Get parent directory path from a file path */
function getParentDirectory(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSlash >= 0 ? path.substring(0, lastSlash) : path;
}

/** Indentation per nesting level in pixels */
const INDENT_PX = 12;

/** Context menu callback props passed down the tree */
export interface FileTreeContextMenuProps {
  projectPath: string | null;
  onRename?: (path: string, newName: string) => Promise<void>;
  onDelete?: (path: string) => Promise<void>;
  onDuplicate?: (path: string) => Promise<void>;
  onNewSpreadsheet?: (folderPath: string) => Promise<void>;
  onRevealInFinder?: (path: string) => Promise<void>;
  onExpandAll?: (folderPath: string) => void;
  onCollapseAll?: (folderPath: string) => void;
  /** Move a file to a new directory (for drag-drop) */
  onMoveFile?: (sourcePath: string, targetDirectory: string) => Promise<void>;
}

/**
 * FileTreeItem component - renders a single file or folder in the tree.
 */
export function FileTreeItem({
  entry,
  depth,
  isActive,
  onClick,
  onToggle,
  activeFilePath,
  onFileClick,
  onToggleFolder,
  contextMenuProps,
}: FileTreeItemProps & {
  /** Active file path (for recursive children) */
  activeFilePath?: string | null;
  /** File click handler (for recursive children) */
  onFileClick?: (path: string) => void;
  /** Folder toggle handler (for recursive children) */
  onToggleFolder?: (path: string) => void;
  /** Context menu callbacks */
  contextMenuProps?: FileTreeContextMenuProps;
}) {
  const isDirectory = entry.isDirectory;
  const isExpanded = entry.isExpanded ?? false;

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Track if we're intentionally canceling rename (to prevent blur from committing)
  const isCancelingRef = useRef(false);

  // Delete confirmation state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Drag-drop state (for moving files into folders)
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // Folder icon (Lucide) - folders don't use native icons
  const FolderIcon = isExpanded ? FolderOpen : Folder;

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      // Select filename without extension
      const nameWithoutExt = getNameWithoutExtension(entry.name);
      inputRef.current.setSelectionRange(0, nameWithoutExt.length);
    }
  }, [isRenaming, entry.name]);

  const handleClick = () => {
    if (isRenaming) return; // Don't trigger click when renaming
    if (isDirectory && onToggle) {
      onToggle();
    } else {
      onClick();
    }
  };

  // Double-click to start rename mode (Issue 81)
  const handleDoubleClick = () => {
    if (isRenaming) return;
    if (contextMenuProps?.onRename) {
      startRename();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isRenaming) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
    // Arrow keys for folder expand/collapse
    if (isDirectory) {
      if (e.key === 'ArrowRight' && !isExpanded && onToggle) {
        e.preventDefault();
        onToggle();
      }
      if (e.key === 'ArrowLeft' && isExpanded && onToggle) {
        e.preventDefault();
        onToggle();
      }
    }
    // Cmd+Delete (Backspace on Mac) or Delete key to delete file
    if ((e.key === 'Backspace' && e.metaKey) || e.key === 'Delete') {
      if (contextMenuProps?.onDelete) {
        e.preventDefault();
        handleDeleteClick();
      }
    }
  };

  // Rename handlers
  const startRename = useCallback(() => {
    setRenameValue(entry.name);
    setIsRenaming(true);
  }, [entry.name]);

  const cancelRename = useCallback(() => {
    isCancelingRef.current = true;
    setIsRenaming(false);
    setRenameValue('');
  }, []);

  const confirmRename = useCallback(async () => {
    const trimmedValue = renameValue.trim();
    if (!trimmedValue || trimmedValue === entry.name) {
      cancelRename();
      return;
    }

    // Validate: no path separators
    if (trimmedValue.includes('/') || trimmedValue.includes('\\')) {
      cancelRename();
      return;
    }

    try {
      await contextMenuProps?.onRename?.(entry.path, trimmedValue);
      setIsRenaming(false);
      setRenameValue('');
    } catch {
      // Keep rename mode on error so user can retry
    }
  }, [renameValue, entry.name, entry.path, contextMenuProps, cancelRename]);

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void confirmRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  const handleRenameBlur = () => {
    // If we're intentionally canceling (e.g., via Escape), don't commit
    if (isCancelingRef.current) {
      isCancelingRef.current = false;
      return;
    }
    // Commit on blur
    void confirmRename();
  };

  // Context menu handlers
  const handleOpen = useCallback(() => {
    onClick();
  }, [onClick]);

  // Opens the delete confirmation dialog
  const handleDeleteClick = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  // Actually performs the delete after user confirms
  const handleDeleteConfirm = useCallback(async () => {
    setIsDeleting(true);
    try {
      await contextMenuProps?.onDelete?.(entry.path);
      setIsDeleteDialogOpen(false);
    } catch {
      // Error handling is done in the parent (toast notification)
      // Keep dialog open on error so user can retry or cancel
    } finally {
      setIsDeleting(false);
    }
  }, [contextMenuProps, entry.path]);

  const handleDuplicate = useCallback(async () => {
    await contextMenuProps?.onDuplicate?.(entry.path);
  }, [contextMenuProps, entry.path]);

  const handleCopyPath = useCallback(async () => {
    await navigator.clipboard.writeText(entry.path);
  }, [entry.path]);

  const handleCopyRelativePath = useCallback(async () => {
    const projectPath = contextMenuProps?.projectPath;
    if (projectPath && entry.path.startsWith(projectPath)) {
      const relativePath = entry.path.substring(projectPath.length + 1); // +1 for the separator
      await navigator.clipboard.writeText(relativePath);
    } else {
      await navigator.clipboard.writeText(entry.path);
    }
  }, [entry.path, contextMenuProps?.projectPath]);

  const handleRevealInFinder = useCallback(async () => {
    await contextMenuProps?.onRevealInFinder?.(entry.path);
  }, [contextMenuProps, entry.path]);

  const handleNewSpreadsheet = useCallback(async () => {
    await contextMenuProps?.onNewSpreadsheet?.(entry.path);
  }, [contextMenuProps, entry.path]);

  const handleExpandAll = useCallback(() => {
    contextMenuProps?.onExpandAll?.(entry.path);
  }, [contextMenuProps, entry.path]);

  const handleCollapseAll = useCallback(() => {
    contextMenuProps?.onCollapseAll?.(entry.path);
  }, [contextMenuProps, entry.path]);

  // Drag-drop handlers for moving files into folders
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      // Only allow dragging files (not folders for now)
      if (isDirectory) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', entry.path);
      e.dataTransfer.effectAllowed = 'move';
    },
    [entry.path, isDirectory],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      // Only folders can receive drops, and don't allow dropping on itself or its parent
      if (!isDirectory || !contextMenuProps?.onMoveFile) {
        return;
      }
      const sourcePath = e.dataTransfer.types.includes('text/plain') ? 'pending' : null;
      if (!sourcePath) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    [isDirectory, contextMenuProps?.onMoveFile],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!isDirectory || !contextMenuProps?.onMoveFile) return;
      e.preventDefault();
      dragCounterRef.current++;
      setIsDragOver(true);
    },
    [isDirectory, contextMenuProps?.onMoveFile],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!isDirectory) return;
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragOver(false);
      }
    },
    [isDirectory],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isDirectory || !contextMenuProps?.onMoveFile) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const sourcePath = e.dataTransfer.getData('text/plain');
      if (!sourcePath) return;

      // Don't allow dropping a file into its current parent directory
      const sourceParent = getParentDirectory(sourcePath);
      if (sourceParent === entry.path) {
        return;
      }

      // Don't allow dropping on itself
      if (sourcePath === entry.path) {
        return;
      }

      await contextMenuProps.onMoveFile(sourcePath, entry.path);
    },
    [isDirectory, entry.path, contextMenuProps],
  );

  // The row content (button or input for rename) — does NOT include recursive children
  const rowContent = isRenaming ? (
    // Rename input mode
    <div
      role="treeitem"
      aria-selected={isActive}
      aria-expanded={isDirectory ? isExpanded : undefined}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm py-1 text-xs',
        'bg-ss-surface-hover border-l-2 border-l-ss-primary',
      )}
      style={{ paddingLeft: `${6 + depth * INDENT_PX}px`, paddingRight: '8px' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Expand/collapse chevron for directories only */}
      {isDirectory && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      )}

      {/* File/folder icon */}
      {isDirectory ? (
        <FolderIcon className="text-ss-text-secondary h-4 w-4 shrink-0" />
      ) : (
        <FileIcon filename={entry.name} />
      )}

      {/* Rename input */}
      <input
        ref={inputRef}
        type="text"
        value={renameValue}
        onChange={(e) => setRenameValue(e.target.value)}
        onKeyDown={handleRenameKeyDown}
        onBlur={handleRenameBlur}
        onClick={(e) => e.stopPropagation()}
        className="text-ss-text bg-ss-surface border-ss-border focus:border-ss-primary min-w-0 flex-1 rounded border px-1 py-0.5 text-xs outline-none"
      />
    </div>
  ) : (
    // Normal button mode
    <button
      role="treeitem"
      aria-selected={isActive}
      aria-expanded={isDirectory ? isExpanded : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      draggable={!isDirectory}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex w-full items-center gap-1.5 py-1 text-xs transition-colors',
        'focus-visible:ring-ss-border-focus focus:outline-none focus-visible:ring-2',
        isActive
          ? 'bg-ss-primary-light text-ss-text font-medium border-l-2 border-l-ss-primary'
          : 'text-ss-text hover:bg-ss-surface-hover border-l-2 border-l-transparent',
        // Drag-over highlight for folders
        isDragOver && isDirectory && 'bg-ss-primary-light/50 ring-ss-primary ring-1 ring-inset',
      )}
      style={{ paddingLeft: `${6 + depth * INDENT_PX}px`, paddingRight: '8px' }}
      title={entry.path}
    >
      {/* Expand/collapse chevron for directories only */}
      {isDirectory && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      )}

      {/* File/folder icon */}
      {isDirectory ? (
        <FolderIcon className="text-ss-text-secondary h-4 w-4 shrink-0" />
      ) : (
        <FileIcon filename={entry.name} />
      )}

      {/* File/folder name */}
      <span className="truncate">{entry.name}</span>
    </button>
  );

  // Recursive children rendered as siblings, outside the context menu trigger
  const childrenContent = isDirectory &&
    isExpanded &&
    entry.children &&
    entry.children.length > 0 && (
      <div role="group">
        {entry.children.map((child) => (
          <FileTreeItem
            key={child.path}
            entry={child}
            depth={depth + 1}
            isActive={!child.isDirectory && activeFilePath === child.path}
            onClick={() => onFileClick?.(child.path)}
            onToggle={child.isDirectory ? () => onToggleFolder?.(child.path) : undefined}
            activeFilePath={activeFilePath}
            onFileClick={onFileClick}
            onToggleFolder={onToggleFolder}
            contextMenuProps={contextMenuProps}
          />
        ))}
      </div>
    );

  // Wrap with context menu if callbacks are provided
  if (contextMenuProps) {
    return (
      <>
        <FileContextMenu
          entry={entry}
          projectPath={contextMenuProps.projectPath}
          onOpen={!isDirectory ? handleOpen : undefined}
          onRename={contextMenuProps.onRename ? startRename : undefined}
          onDelete={contextMenuProps.onDelete ? handleDeleteClick : undefined}
          onDuplicate={!isDirectory && contextMenuProps.onDuplicate ? handleDuplicate : undefined}
          onCopyPath={handleCopyPath}
          onCopyRelativePath={handleCopyRelativePath}
          onRevealInFinder={contextMenuProps.onRevealInFinder ? handleRevealInFinder : undefined}
          onNewSpreadsheet={
            isDirectory && contextMenuProps.onNewSpreadsheet ? handleNewSpreadsheet : undefined
          }
          onExpandAll={isDirectory && contextMenuProps.onExpandAll ? handleExpandAll : undefined}
          onCollapseAll={
            isDirectory && contextMenuProps.onCollapseAll ? handleCollapseAll : undefined
          }
        >
          {rowContent}
        </FileContextMenu>
        {childrenContent}

        {/* Delete confirmation dialog */}
        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          name={entry.name}
          isDirectory={isDirectory}
          onConfirm={handleDeleteConfirm}
          isDeleting={isDeleting}
        />
      </>
    );
  }

  return (
    <>
      {rowContent}
      {childrenContent}
    </>
  );
}

/**
 * Render a complete file tree from an array of entries.
 * This is a convenience wrapper for rendering the top-level tree.
 */
export function FileTree({
  entries,
  activeFilePath,
  onFileClick,
  onToggleFolder,
  contextMenuProps,
}: {
  entries: ProjectFileEntry[];
  activeFilePath: string | null;
  onFileClick: (path: string) => void;
  onToggleFolder: (path: string) => void;
  contextMenuProps?: FileTreeContextMenuProps;
}) {
  if (entries.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <VscFile className="text-ss-text-secondary mx-auto h-8 w-8" />
        <p className="text-ss-text-secondary mt-2 text-sm">No supported files</p>
        <p className="text-ss-text-tertiary mt-1 text-xs">
          Add spreadsheets, code, PDFs, or other supported files
        </p>
      </div>
    );
  }

  return (
    <div role="tree" className="space-y-0.5 py-1">
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          depth={0}
          isActive={!entry.isDirectory && activeFilePath === entry.path}
          onClick={() => (entry.isDirectory ? onToggleFolder(entry.path) : onFileClick(entry.path))}
          onToggle={entry.isDirectory ? () => onToggleFolder(entry.path) : undefined}
          activeFilePath={activeFilePath}
          onFileClick={onFileClick}
          onToggleFolder={onToggleFolder}
          contextMenuProps={contextMenuProps}
        />
      ))}
    </div>
  );
}
