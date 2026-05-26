/**
 * File Explorer Components
 *
 * VS Code-like file tree sidebar for browsing project files.
 * Copied from client/desktop/src/components/project/
 */

export { DeleteConfirmDialog, type DeleteConfirmDialogProps } from './DeleteConfirmDialog';
export { FileIcon, getFileExtension, getNameWithoutExtension } from './file-icons';
export { FileContextMenu, type FileContextMenuProps } from './FileContextMenu';
export { FileExplorer } from './FileExplorer';
export { FileTree, FileTreeItem, type FileTreeContextMenuProps } from './FileTreeItem';
export type { FileExplorerProps, FileTreeItemProps, ProjectFileEntry } from './types';
