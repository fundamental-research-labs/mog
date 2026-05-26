import type { DirPath, FilePath } from './paths';
import { isAbsolute, joinPath, normalizePath } from './paths';
import type { AppId } from './permissions';
import { PathEscapeError, PermissionDeniedError } from './permissions';
import type { FileEntry, FileStat, IFileSystem, IFilesystemService, WatchEvent } from './types';

// Re-export path utilities for consumers
export { getBasename, getDirname, joinPath, normalizePath } from './paths';

// Re-export error classes for consumers
export {
  DirectoryExistsError,
  DirectoryNotEmptyError,
  DirectoryNotFoundError,
  FileExistsError,
  FileNotFoundError,
  IsDirectoryError,
  NotDirectoryError,
} from './types';

type Unsubscribe = () => void;

/**
 * Creates a sandboxed filesystem for an app.
 * All paths are relative to /apps/{appId}/ and cannot escape the sandbox.
 */
export function createAppFileSystem(backend: IFileSystem, appId: AppId): IFileSystem {
  const root = `/apps/${appId}`;

  /**
   * Resolve an app-relative path to an absolute path in the backend.
   * Validates that the path doesn't escape the sandbox.
   */
  function resolvePath(path: string): string {
    // Normalize the path
    const normalized = normalizePath(path);

    // Reject absolute paths
    if (isAbsolute(normalized)) {
      throw new PathEscapeError(path);
    }

    // Reject path traversal attempts
    const parts = normalized.split('/');
    let depth = 0;
    for (const part of parts) {
      if (part === '..') {
        depth--;
        if (depth < 0) {
          throw new PathEscapeError(path);
        }
      } else if (part !== '.' && part !== '') {
        depth++;
      }
    }

    // Join with root
    const fullPath = joinPath(root, normalized);

    // Double-check the resolved path is under root
    if (!fullPath.startsWith(root + '/') && fullPath !== root) {
      throw new PathEscapeError(path);
    }

    return fullPath;
  }

  /**
   * Strip the root prefix from a path to return an app-relative path.
   */
  function stripRoot(fullPath: string): string {
    if (fullPath.startsWith(root + '/')) {
      return fullPath.slice(root.length + 1);
    }
    if (fullPath === root) {
      return '';
    }
    return fullPath;
  }

  // Create sandboxed filesystem
  const sandboxedFs: IFileSystem = {
    async read(path: FilePath): Promise<Uint8Array> {
      return backend.read(resolvePath(path) as FilePath);
    },

    async readText(path: FilePath): Promise<string> {
      return backend.readText(resolvePath(path) as FilePath);
    },

    async write(path: FilePath, content: Uint8Array | string): Promise<void> {
      return backend.write(resolvePath(path) as FilePath, content);
    },

    async append(path: FilePath, content: Uint8Array | string): Promise<void> {
      return backend.append(resolvePath(path) as FilePath, content);
    },

    async delete(path: FilePath, options?: { trash?: boolean }): Promise<void> {
      return backend.delete(resolvePath(path) as FilePath, options);
    },

    async exists(path: FilePath): Promise<boolean> {
      return backend.exists(resolvePath(path) as FilePath);
    },

    async stat(path: FilePath): Promise<FileStat> {
      return backend.stat(resolvePath(path) as FilePath);
    },

    async list(dir: DirPath): Promise<FileEntry[]> {
      const entries = await backend.list(resolvePath(dir) as DirPath);
      // Transform paths back to app-relative
      return entries.map((entry) => ({
        ...entry,
        path: stripRoot(entry.path) as FilePath,
      }));
    },

    async mkdir(dir: DirPath, options?: { recursive?: boolean }): Promise<void> {
      return backend.mkdir(resolvePath(dir) as DirPath, options);
    },

    async rmdir(dir: DirPath, options?: { recursive?: boolean }): Promise<void> {
      return backend.rmdir(resolvePath(dir) as DirPath, options);
    },

    async rename(from: FilePath, to: FilePath): Promise<void> {
      return backend.rename(resolvePath(from) as FilePath, resolvePath(to) as FilePath);
    },

    async copy(from: FilePath, to: FilePath): Promise<void> {
      return backend.copy(resolvePath(from) as FilePath, resolvePath(to) as FilePath);
    },

    watch: backend.watch
      ? (path: FilePath | DirPath, cb: (event: WatchEvent) => void): Unsubscribe => {
          return backend.watch!(resolvePath(path) as FilePath | DirPath, (event) => {
            // Transform paths in event back to app-relative
            switch (event.type) {
              case 'create':
                cb({
                  type: 'create',
                  path: stripRoot(event.path) as FilePath | DirPath,
                });
                break;
              case 'modify':
                cb({
                  type: 'modify',
                  path: stripRoot(event.path) as FilePath,
                });
                break;
              case 'delete':
                cb({
                  type: 'delete',
                  path: stripRoot(event.path) as FilePath | DirPath,
                });
                break;
              case 'rename':
                cb({
                  type: 'rename',
                  oldPath: stripRoot(event.oldPath) as FilePath | DirPath,
                  newPath: stripRoot(event.newPath) as FilePath | DirPath,
                });
                break;
            }
          });
        }
      : undefined,
  };

  return sandboxedFs;
}

/**
 * Filesystem service for the kernel.
 * Manages app filesystems and ensures proper isolation.
 */
class FilesystemService implements IFilesystemService {
  private appFilesystems: Map<string, IFileSystem> = new Map();

  constructor(private backend: IFileSystem) {}

  /**
   * Get or create a sandboxed filesystem for an app.
   */
  getAppFileSystem(appId: AppId): IFileSystem {
    const key = String(appId);

    if (!this.appFilesystems.has(key)) {
      const sandboxed = createAppFileSystem(this.backend, appId);
      this.appFilesystems.set(key, sandboxed);
    }

    return this.appFilesystems.get(key)!;
  }

  /**
   * Initialize the filesystem structure for a new app.
   * Creates the app directory if it doesn't exist.
   */
  async initializeApp(appId: AppId): Promise<void> {
    const appRoot = `/apps/${appId}` as DirPath;

    try {
      const exists = await this.backend.exists(appRoot);
      if (!exists) {
        await this.backend.mkdir(appRoot, { recursive: true });
      }
    } catch (_error) {
      // Directory may already exist
    }
  }

  /**
   * Remove all files for an app (for uninstallation).
   */
  async removeApp(appId: AppId): Promise<void> {
    const appRoot = `/apps/${appId}` as DirPath;

    try {
      await this.backend.rmdir(appRoot, { recursive: true });
      this.appFilesystems.delete(String(appId));
    } catch (_error) {
      // Ignore if already removed
    }
  }

  /**
   * Get the backend filesystem (for system-level operations).
   */
  getBackend(): IFileSystem {
    return this.backend;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Dispose the filesystem service and clear all cached app filesystems.
   */
  dispose(): void {
    this.appFilesystems.clear();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new FilesystemService instance.
 *
 * @param backend - The filesystem backend implementation
 * @returns A new FilesystemService
 */
export function createFilesystemService(backend: IFileSystem): IFilesystemService {
  return new FilesystemService(backend);
}

// Export types
export { PathEscapeError, PermissionDeniedError };
