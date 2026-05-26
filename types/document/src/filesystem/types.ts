/**
 * Filesystem abstraction contracts for Spreadsheet OS.
 *
 * TYPES ONLY — defines the core filesystem interface that can be implemented
 * by different backends (native fs, OPFS, memory, etc.) while providing
 * a consistent API for the application layer.
 *
 * Error classes and runtime code live in @mog-sdk/kernel/services/filesystem/types.
 */

import type { DirPath, FilePath } from './paths';

/**
 * Core filesystem interface.
 *
 * All operations are async to support both synchronous (native fs) and
 * asynchronous (OPFS, network) backends uniformly.
 */
export interface IFileSystem {
  // ============================================================
  // Read Operations
  // ============================================================

  /**
   * Read file contents as binary data.
   * @param path - Absolute path to the file
   * @returns File contents as Uint8Array
   * @throws FileNotFoundError if file doesn't exist
   * @throws PermissionDeniedError if access is denied
   */
  read(path: FilePath): Promise<Uint8Array>;

  /**
   * Read file contents as UTF-8 text.
   * @param path - Absolute path to the file
   * @returns File contents as string
   * @throws FileNotFoundError if file doesn't exist
   * @throws PermissionDeniedError if access is denied
   */
  readText(path: FilePath): Promise<string>;

  // ============================================================
  // Write Operations
  // ============================================================

  /**
   * Write content to a file, creating or overwriting as needed.
   * Parent directories must exist.
   * @param path - Absolute path to the file
   * @param content - Content to write (binary or text)
   * @throws PermissionDeniedError if access is denied
   * @throws DirectoryNotFoundError if parent directory doesn't exist
   */
  write(path: FilePath, content: Uint8Array | string): Promise<void>;

  /**
   * Append content to a file, creating if it doesn't exist.
   * Parent directories must exist.
   * @param path - Absolute path to the file
   * @param content - Content to append (binary or text)
   * @throws PermissionDeniedError if access is denied
   * @throws DirectoryNotFoundError if parent directory doesn't exist
   */
  append(path: FilePath, content: Uint8Array | string): Promise<void>;

  // ============================================================
  // Delete Operations
  // ============================================================

  /**
   * Delete a file.
   * @param path - Absolute path to the file
   * @param options.trash - Move to trash instead of permanent delete (default: false)
   * @throws FileNotFoundError if file doesn't exist
   * @throws PermissionDeniedError if access is denied
   */
  delete(path: FilePath, options?: DeleteOptions): Promise<void>;

  // ============================================================
  // Query Operations
  // ============================================================

  /**
   * Check if a file or directory exists.
   * @param path - Absolute path to check
   * @returns true if path exists, false otherwise
   */
  exists(path: FilePath | DirPath): Promise<boolean>;

  /**
   * Get file or directory metadata.
   * @param path - Absolute path to the file or directory
   * @returns File statistics
   * @throws FileNotFoundError if path doesn't exist
   * @throws PermissionDeniedError if access is denied
   */
  stat(path: FilePath | DirPath): Promise<FileStat>;

  // ============================================================
  // Directory Operations
  // ============================================================

  /**
   * List contents of a directory.
   * @param dir - Absolute path to the directory
   * @returns Array of file entries
   * @throws DirectoryNotFoundError if directory doesn't exist
   * @throws PermissionDeniedError if access is denied
   */
  list(dir: DirPath): Promise<FileEntry[]>;

  /**
   * Create a directory.
   * @param dir - Absolute path to the directory
   * @param options.recursive - Create parent directories if needed (default: false)
   * @throws DirectoryExistsError if directory already exists (and not recursive)
   * @throws PermissionDeniedError if access is denied
   */
  mkdir(dir: DirPath, options?: MkdirOptions): Promise<void>;

  /**
   * Remove a directory.
   * @param dir - Absolute path to the directory
   * @param options.recursive - Remove contents recursively (default: false)
   * @throws DirectoryNotFoundError if directory doesn't exist
   * @throws DirectoryNotEmptyError if directory is not empty (and not recursive)
   * @throws PermissionDeniedError if access is denied
   */
  rmdir(dir: DirPath, options?: RmdirOptions): Promise<void>;

  // ============================================================
  // Move/Copy Operations
  // ============================================================

  /**
   * Rename or move a file.
   * @param from - Source path
   * @param to - Destination path
   * @throws FileNotFoundError if source doesn't exist
   * @throws FileExistsError if destination already exists
   * @throws PermissionDeniedError if access is denied
   */
  rename(from: FilePath, to: FilePath): Promise<void>;

  /**
   * Copy a file.
   * @param from - Source path
   * @param to - Destination path
   * @throws FileNotFoundError if source doesn't exist
   * @throws FileExistsError if destination already exists
   * @throws PermissionDeniedError if access is denied
   */
  copy(from: FilePath, to: FilePath): Promise<void>;

  // ============================================================
  // Watch Operations (Optional)
  // ============================================================

  /**
   * Watch a file or directory for changes.
   * Not all backends support this operation.
   * @param path - Path to watch
   * @param callback - Called when changes occur
   * @returns Unsubscribe function to stop watching
   */
  watch?(path: FilePath | DirPath, callback: WatchCallback): Unsubscribe;
}

// ============================================================
// Option Types
// ============================================================

/**
 * Options for delete operation.
 */
export interface DeleteOptions {
  /**
   * Move to trash instead of permanent delete.
   * @default false
   */
  trash?: boolean;
}

/**
 * Options for mkdir operation.
 */
export interface MkdirOptions {
  /**
   * Create parent directories if they don't exist.
   * @default false
   */
  recursive?: boolean;
}

/**
 * Options for rmdir operation.
 */
export interface RmdirOptions {
  /**
   * Remove directory contents recursively.
   * @default false
   */
  recursive?: boolean;
}

// ============================================================
// Data Types
// ============================================================

/**
 * File or directory metadata.
 */
export interface FileStat {
  /**
   * Size in bytes (0 for directories).
   */
  size: number;

  /**
   * Creation timestamp (milliseconds since epoch).
   */
  created: number;

  /**
   * Last modification timestamp (milliseconds since epoch).
   */
  modified: number;

  /**
   * True if this is a directory.
   */
  isDirectory: boolean;

  /**
   * True if this is a regular file.
   */
  isFile: boolean;

  /**
   * True if this is a symbolic link.
   */
  isSymlink: boolean;
}

/**
 * Entry in a directory listing.
 */
export interface FileEntry {
  /**
   * File or directory name (without path).
   */
  name: string;

  /**
   * Full absolute path.
   */
  path: FilePath | DirPath;

  /**
   * True if this is a directory.
   */
  isDirectory: boolean;

  /**
   * True if this is a regular file.
   */
  isFile: boolean;

  /**
   * True if this is a symbolic link.
   */
  isSymlink: boolean;
}

// ============================================================
// Watch Types
// ============================================================

/**
 * Events emitted by file watchers.
 */
export type WatchEvent = WatchCreateEvent | WatchModifyEvent | WatchDeleteEvent | WatchRenameEvent;

/**
 * File or directory was created.
 */
export interface WatchCreateEvent {
  type: 'create';
  path: FilePath | DirPath;
}

/**
 * File was modified.
 */
export interface WatchModifyEvent {
  type: 'modify';
  path: FilePath;
}

/**
 * File or directory was deleted.
 */
export interface WatchDeleteEvent {
  type: 'delete';
  path: FilePath | DirPath;
}

/**
 * File or directory was renamed/moved.
 */
export interface WatchRenameEvent {
  type: 'rename';
  oldPath: FilePath | DirPath;
  newPath: FilePath | DirPath;
}

/**
 * Callback for watch events.
 */
export type WatchCallback = (event: WatchEvent) => void;

/**
 * Function to stop watching.
 */
export type Unsubscribe = () => void;
