/**
 * FileContextMenu - Context menu for file explorer items
 *
 * Provides right-click actions for files (spreadsheets) and folders:
 * - Files: Open, Rename, Delete, Duplicate, Copy Path, Reveal in Finder
 * - Folders: New Spreadsheet, Rename, Delete, Copy Path, Expand/Collapse All, Reveal in Finder
 */

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../ui/radix/ContextMenu';
import { usePlatformInfo } from '../../hooks/use-platform-info';
import type { ProjectFileEntry } from './types';

/** Simple shortcut display component */
function ContextMenuShortcut({ children }: { children: React.ReactNode }) {
  return <span className="ml-auto text-xs tracking-widest opacity-60">{children}</span>;
}

export interface FileContextMenuProps {
  /** The file or folder entry */
  entry: ProjectFileEntry;
  /** Project root path (for relative path calculation) */
  projectPath: string | null;
  /** Trigger element (the FileTreeItem) */
  children: React.ReactNode;

  // File actions
  /** Called when "Open" is selected (files only) */
  onOpen?: () => void;
  /** Called when "Rename" is selected */
  onRename?: () => void;
  /** Called when "Delete" is selected */
  onDelete?: () => void;
  /** Called when "Duplicate" is selected (files only) */
  onDuplicate?: () => void;
  /** Called when "Copy Path" is selected */
  onCopyPath?: () => void;
  /** Called when "Copy Relative Path" is selected */
  onCopyRelativePath?: () => void;
  /** Called when "Reveal in Finder" is selected */
  onRevealInFinder?: () => void;

  // Folder-only actions
  /** Called when "New Spreadsheet" is selected (folders only) */
  onNewSpreadsheet?: () => void;
  /** Called when "Expand All" is selected (folders only) */
  onExpandAll?: () => void;
  /** Called when "Collapse All" is selected (folders only) */
  onCollapseAll?: () => void;
}

/**
 * FileContextMenu wraps a file tree item with a right-click context menu.
 */
export function FileContextMenu({
  entry,
  projectPath: _projectPath,
  children,
  onOpen,
  onRename,
  onDelete,
  onDuplicate,
  onCopyPath,
  onCopyRelativePath,
  onRevealInFinder,
  onNewSpreadsheet,
  onExpandAll,
  onCollapseAll,
}: FileContextMenuProps) {
  const isDirectory = entry.isDirectory;
  const { isMacOS } = usePlatformInfo();
  const revealLabel = isMacOS ? 'Reveal in Finder' : 'Show in Explorer';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {isDirectory ? (
          // Folder menu items
          <>
            {onNewSpreadsheet && (
              <ContextMenuItem onSelect={onNewSpreadsheet}>New Spreadsheet</ContextMenuItem>
            )}
            {onNewSpreadsheet && <ContextMenuSeparator />}
            {onRename && <ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>}
            {onDelete && (
              <ContextMenuItem onSelect={onDelete} className="text-destructive">
                Delete
                <ContextMenuShortcut>⌫</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {(onRename || onDelete) && <ContextMenuSeparator />}
            {onCopyPath && (
              <ContextMenuItem onSelect={onCopyPath}>
                Copy Path
                <ContextMenuShortcut>{isMacOS ? '⌘C' : 'Ctrl+C'}</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {onCopyRelativePath && (
              <ContextMenuItem onSelect={onCopyRelativePath}>
                Copy Relative Path
                <ContextMenuShortcut>{isMacOS ? '⌥⌘C' : 'Ctrl+Alt+C'}</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {onRevealInFinder && (
              <ContextMenuItem onSelect={onRevealInFinder}>{revealLabel}</ContextMenuItem>
            )}
            {(onExpandAll || onCollapseAll) && <ContextMenuSeparator />}
            {onExpandAll && <ContextMenuItem onSelect={onExpandAll}>Expand All</ContextMenuItem>}
            {onCollapseAll && (
              <ContextMenuItem onSelect={onCollapseAll}>Collapse All</ContextMenuItem>
            )}
          </>
        ) : (
          // File menu items
          <>
            {onOpen && (
              <ContextMenuItem onSelect={onOpen}>
                Open
                <ContextMenuShortcut>Enter</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {onOpen && <ContextMenuSeparator />}
            {onRename && <ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>}
            {onDelete && (
              <ContextMenuItem onSelect={onDelete} className="text-destructive">
                Delete
                <ContextMenuShortcut>⌫</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {onDuplicate && <ContextMenuItem onSelect={onDuplicate}>Duplicate</ContextMenuItem>}
            {(onRename || onDelete || onDuplicate) && <ContextMenuSeparator />}
            {onCopyPath && (
              <ContextMenuItem onSelect={onCopyPath}>
                Copy Path
                <ContextMenuShortcut>{isMacOS ? '⌘C' : 'Ctrl+C'}</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {onCopyRelativePath && (
              <ContextMenuItem onSelect={onCopyRelativePath}>
                Copy Relative Path
                <ContextMenuShortcut>{isMacOS ? '⌥⌘C' : 'Ctrl+Alt+C'}</ContextMenuShortcut>
              </ContextMenuItem>
            )}
            {onRevealInFinder && (
              <ContextMenuItem onSelect={onRevealInFinder}>{revealLabel}</ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
