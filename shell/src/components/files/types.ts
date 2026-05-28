/**
 * Types for the File Explorer components
 *
 * Copied from client/desktop/src/types/contracts.ts
 */

/**
 * Represents a file or folder in the project explorer.
 */
export interface ProjectFileEntry {
  /** File or folder name */
  name: string;

  /** Absolute path */
  path: string;

  /** Whether this is a directory */
  isDirectory: boolean;

  /** Child entries (only for directories) */
  children?: ProjectFileEntry[];

  /** Whether directory is expanded in UI */
  isExpanded?: boolean;
}

/**
 * Props for FileExplorer sidebar component.
 */
export interface FileExplorerProps {
  /** Project name (shown at top of explorer) */
  projectName: string | null;

  /** Project root path (for relative path calculation) */
  projectPath: string | null;

  /** File tree to display */
  fileTree: ProjectFileEntry[];

  /** Currently active file path (for highlighting) */
  activeFilePath: string | null;

  /** Called when a file is clicked */
  onFileClick: (path: string) => void;

  /** Called when a folder expand/collapse is toggled */
  onToggleFolder: (path: string) => void;

  /** Called when refresh button is clicked */
  onRefresh: () => void;

  /** Called when collapse sidebar button is clicked */
  onCollapse?: () => void;

  /** Whether explorer is collapsed */
  isCollapsed?: boolean;

  // Context menu callbacks
  /** Called when "Rename" is selected from context menu */
  onRename?: (path: string, newName: string) => Promise<void>;
  /** Called when "Delete" is selected from context menu */
  onDelete?: (path: string) => Promise<void>;
  /** Called when "Duplicate" is selected from context menu (files only) */
  onDuplicate?: (path: string) => Promise<void>;
  /** Called when "New Spreadsheet" is selected */
  onNewSpreadsheet?: (folderPath: string | null) => Promise<void>;
  /** Called when "New Folder" button or context menu is selected */
  onNewFolder?: (parentPath: string) => Promise<void>;
  /** Called when "Reveal in Finder" is selected */
  onRevealInFinder?: (path: string) => Promise<void>;
  /** Called to expand all children of a folder */
  onExpandAll?: (folderPath: string) => void;
  /** Called to collapse all children of a folder */
  onCollapseAll?: (folderPath: string) => void;
  /** Called when files are dropped from external source (e.g., Finder) */
  onImportFiles?: (sourcePaths: string[], targetDirectory: string) => Promise<void>;
  /** Called when a file is dragged and dropped onto a folder */
  onMoveFile?: (sourcePath: string, targetDirectory: string) => Promise<void>;
}

/**
 * Props for FileTreeItem component (recursive).
 */
export interface FileTreeItemProps {
  /** The file/folder entry */
  entry: ProjectFileEntry;

  /** Nesting depth (for indentation) */
  depth: number;

  /** Whether this file is currently active */
  isActive: boolean;

  /** Called when clicked */
  onClick: () => void;

  /** Called when folder toggle is clicked */
  onToggle?: () => void;
}
