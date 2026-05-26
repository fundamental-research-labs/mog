/**
 * Mock IPC Client
 *
 * In-memory implementation for unit testing without Tauri runtime.
 * Simulates filesystem operations using Map and Set data structures.
 *
 * @example
 * ```ts
 * import { createMockIpc, MockFileSystem } from './mock-ipc';
 *
 * // Create with empty filesystem
 * const ipc = createMockIpc();
 *
 * // Create with pre-populated filesystem
 * const fs: MockFileSystem = {
 *   files: new Map([
 *     ['/project/data.xlsx', new Uint8Array([1, 2, 3])],
 *   ]),
 *   directories: new Set(['/project']),
 * };
 * const ipc = createMockIpc(fs);
 * ```
 */

import type { ProjectIpc } from './ipc-types';
import type { ProjectFileEntry, RecentProject } from './types';

/**
 * In-memory filesystem representation for testing.
 */
export interface MockFileSystem {
  /** Map of file paths to their content (as Uint8Array) */
  files: Map<string, Uint8Array>;
  /** Set of directory paths */
  directories: Set<string>;
}

/**
 * Create an empty mock filesystem.
 */
export function createMockFileSystem(): MockFileSystem {
  return {
    files: new Map(),
    directories: new Set(),
  };
}

/**
 * Extract the file name from a path.
 */
function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Extract the file extension from a path (lowercase).
 */
function getExtension(path: string): string {
  const name = getFileName(path);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.substring(dotIndex + 1).toLowerCase() : '';
}

/**
 * Extract the parent directory from a path.
 */
function getParentDir(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash > 0 ? path.substring(0, lastSlash) : '/';
}

/**
 * Check if a path is a child of a directory.
 */
function isChildOf(path: string, directory: string): boolean {
  // Ensure directory ends with / for proper matching
  const dirWithSlash = directory.endsWith('/') ? directory : `${directory}/`;
  return path.startsWith(dirWithSlash);
}

/**
 * Get the immediate relative path under a directory.
 */
function getImmediateChild(path: string, directory: string): string | null {
  if (!isChildOf(path, directory)) return null;

  const relativePath = path.substring(
    directory.endsWith('/') ? directory.length : directory.length + 1,
  );
  const firstSlash = relativePath.indexOf('/');
  return firstSlash >= 0 ? relativePath.substring(0, firstSlash) : relativePath;
}

/**
 * Recursive helper function to scan a project folder in the mock filesystem.
 */
function scanProjectFolderRecursive(
  fs: MockFileSystem,
  path: string,
  extensionSet: Set<string>,
): ProjectFileEntry[] {
  const entries: ProjectFileEntry[] = [];

  // Collect all immediate children (files and directories)
  const childrenMap = new Map<string, { isDirectory: boolean }>();

  // Check files
  for (const [filePath] of fs.files) {
    if (!isChildOf(filePath, path)) continue;

    const childName = getImmediateChild(filePath, path);
    if (!childName) continue;

    const fullChildPath = `${path}/${childName}`;
    const isDir = fs.directories.has(fullChildPath);

    if (!isDir) {
      // Direct file child - check extension
      const ext = getExtension(filePath);
      if (extensionSet.has(ext)) {
        childrenMap.set(childName, { isDirectory: false });
      }
    } else if (!childrenMap.has(childName)) {
      childrenMap.set(childName, { isDirectory: true });
    }
  }

  // Check directories
  for (const dirPath of fs.directories) {
    if (!isChildOf(dirPath, path)) continue;

    const childName = getImmediateChild(dirPath, path);
    if (!childName) continue;

    const fullChildPath = `${path}/${childName}`;
    if (fs.directories.has(fullChildPath) && !childrenMap.has(childName)) {
      childrenMap.set(childName, { isDirectory: true });
    }
  }

  // Build entries
  for (const [name, info] of childrenMap) {
    const entryPath = `${path}/${name}`;

    if (info.isDirectory) {
      // Recursively scan subdirectory
      const children = scanProjectFolderRecursive(fs, entryPath, extensionSet);

      // Only include folders that have matching content
      if (children.length > 0) {
        entries.push({
          name,
          path: entryPath,
          isDirectory: true,
          children,
        });
      }
    } else {
      entries.push({
        name,
        path: entryPath,
        isDirectory: false,
      });
    }
  }

  // Sort: folders first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return entries;
}

/**
 * Create a mock IPC client that implements the ProjectIpc interface.
 *
 * All operations work on in-memory data structures, making this suitable
 * for unit testing without requiring the Tauri runtime.
 *
 * @param fs - Optional pre-populated filesystem. Defaults to empty filesystem.
 * @returns ProjectIpc implementation using in-memory data structures
 */
export function createMockIpc(fs: MockFileSystem = createMockFileSystem()): ProjectIpc {
  let recentProjects: RecentProject[] = [];

  return {
    // =========================================================================
    // File I/O
    // =========================================================================

    read_file: async ({ path }) => {
      const data = fs.files.get(path);
      if (!data) {
        throw new Error(`File not found: ${path}`);
      }
      return data;
    },

    write_file: async ({ path, data }) => {
      fs.files.set(path, new Uint8Array(data));
      // Ensure parent directories exist
      let dir = getParentDir(path);
      while (dir && dir !== '/') {
        fs.directories.add(dir);
        dir = getParentDir(dir);
      }
    },

    // =========================================================================
    // Project Scanning
    // =========================================================================

    scan_project_folder: async ({ path, extensions }) => {
      const extensionSet = new Set(extensions.map((e) => e.toLowerCase()));
      return scanProjectFolderRecursive(fs, path, extensionSet);
    },

    show_open_folder_dialog: async () => {
      // In mock, return null (user cancelled)
      return null;
    },

    is_directory: async ({ path }) => {
      return fs.directories.has(path);
    },

    reveal_in_file_manager: async () => {
      // No-op in mock
    },

    // =========================================================================
    // File Operations
    // =========================================================================

    rename_path: async ({ oldPath, newPath }) => {
      // Handle file rename
      const fileData = fs.files.get(oldPath);
      if (fileData) {
        fs.files.delete(oldPath);
        fs.files.set(newPath, fileData);
        return newPath;
      }

      // Handle directory rename
      if (fs.directories.has(oldPath)) {
        fs.directories.delete(oldPath);
        fs.directories.add(newPath);

        // Rename all files and subdirectories under this path
        const oldPrefix = oldPath + '/';
        const newPrefix = newPath + '/';

        // Rename files
        const filesToRename: Array<[string, Uint8Array]> = [];
        for (const [filePath, data] of fs.files) {
          if (filePath.startsWith(oldPrefix)) {
            filesToRename.push([filePath, data]);
          }
        }
        for (const [oldFilePath, data] of filesToRename) {
          fs.files.delete(oldFilePath);
          fs.files.set(oldFilePath.replace(oldPrefix, newPrefix), data);
        }

        // Rename directories
        const dirsToRename: string[] = [];
        for (const dirPath of fs.directories) {
          if (dirPath.startsWith(oldPrefix)) {
            dirsToRename.push(dirPath);
          }
        }
        for (const oldDirPath of dirsToRename) {
          fs.directories.delete(oldDirPath);
          fs.directories.add(oldDirPath.replace(oldPrefix, newPrefix));
        }

        return newPath;
      }

      throw new Error(`Path not found: ${oldPath}`);
    },

    delete_path: async ({ path }) => {
      // Delete file
      if (fs.files.has(path)) {
        fs.files.delete(path);
        return;
      }

      // Delete directory and all contents
      if (fs.directories.has(path)) {
        fs.directories.delete(path);

        const prefix = path + '/';

        // Delete all files under this path
        for (const filePath of fs.files.keys()) {
          if (filePath.startsWith(prefix)) {
            fs.files.delete(filePath);
          }
        }

        // Delete all subdirectories
        for (const dirPath of fs.directories) {
          if (dirPath.startsWith(prefix)) {
            fs.directories.delete(dirPath);
          }
        }

        return;
      }

      throw new Error(`Path not found: ${path}`);
    },

    copy_file: async ({ source, dest }) => {
      const data = fs.files.get(source);
      if (!data) {
        throw new Error(`File not found: ${source}`);
      }

      const target = dest ?? `${source}.copy`;
      fs.files.set(target, new Uint8Array(data));

      // Ensure parent directories exist
      let dir = getParentDir(target);
      while (dir && dir !== '/') {
        fs.directories.add(dir);
        dir = getParentDir(dir);
      }

      return target;
    },

    create_empty_spreadsheet: async ({ path }) => {
      // Create a minimal "empty" spreadsheet (just empty bytes in mock)
      fs.files.set(path, new Uint8Array(0));

      // Ensure parent directories exist
      let dir = getParentDir(path);
      while (dir && dir !== '/') {
        fs.directories.add(dir);
        dir = getParentDir(dir);
      }
    },

    create_folder: async ({ path }) => {
      fs.directories.add(path);

      // Ensure parent directories exist
      let dir = getParentDir(path);
      while (dir && dir !== '/') {
        fs.directories.add(dir);
        dir = getParentDir(dir);
      }
    },

    generate_unique_filename: async ({ directory, baseName, extension }) => {
      let counter = 0;
      const maxAttempts = 1000;

      while (counter < maxAttempts) {
        const name =
          counter === 0 ? `${baseName}.${extension}` : `${baseName} ${counter}.${extension}`;
        const fullPath = `${directory}/${name}`;

        if (!fs.files.has(fullPath)) {
          return fullPath;
        }
        counter++;
      }

      throw new Error('Could not generate unique filename');
    },

    generate_unique_folder_name: async ({ directory, baseName }) => {
      let counter = 0;
      const maxAttempts = 1000;

      while (counter < maxAttempts) {
        const name = counter === 0 ? baseName : `${baseName} ${counter}`;
        const fullPath = `${directory}/${name}`;

        if (!fs.directories.has(fullPath) && !fs.files.has(fullPath)) {
          return fullPath;
        }
        counter++;
      }

      throw new Error('Could not generate unique folder name');
    },

    import_files: async ({ sourcePaths, targetDirectory }) => {
      const imported: string[] = [];

      for (const source of sourcePaths) {
        const data = fs.files.get(source);
        if (data) {
          const name = getFileName(source);
          const target = `${targetDirectory}/${name}`;
          fs.files.set(target, new Uint8Array(data));
          imported.push(target);
        }
      }

      // Ensure target directory exists
      fs.directories.add(targetDirectory);

      return imported;
    },

    // =========================================================================
    // Recent Projects
    // =========================================================================

    get_recent_projects: async () => {
      return [...recentProjects];
    },

    add_recent_project: async ({ project }) => {
      // Remove existing entry with same path and add to front
      recentProjects = [project, ...recentProjects.filter((p) => p.path !== project.path)].slice(
        0,
        10,
      ); // Keep only 10 most recent
    },

    clear_recent_projects: async () => {
      recentProjects = [];
    },
  };
}
