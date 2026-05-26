/**
 * Tauri filesystem implementation for Spreadsheet OS.
 *
 * Uses native Rust commands via @tauri-apps/api for IPC with the Tauri backend.
 * Provides full IFileSystem implementation for desktop applications.
 *
 * SECURITY: All custom file commands use secureInvoke which handles:
 * - HMAC request signing
 * - Window verification
 * - Rate limiting (for Protected+ levels)
 * - Audit logging (for Sensitive+ levels)
 * - Path sandboxing is enforced in Rust
 */

import type { DirPath, FilePath } from '@mog-sdk/contracts/filesystem';
import { normalizePath } from '../filesystem-paths';
import type {
  DeleteOptions,
  FileEntry,
  FileStat,
  IFileSystem,
  MkdirOptions,
  RmdirOptions,
  Unsubscribe,
  WatchCallback,
  WatchEvent,
} from '@mog-sdk/contracts/filesystem';
import { isTauri } from './detection';
import { secureInvoke } from './secure-invoke';

/**
 * Tauri filesystem implementation using native Rust commands.
 *
 * This implementation uses the @tauri-apps/api package to invoke Rust commands
 * defined in src-tauri/src/commands/. It provides full filesystem access on
 * desktop platforms.
 *
 * @example
 * ```ts
 * const fs = new TauriFileSystem();
 *
 * // Read a file
 * const content = await fs.readText('/path/to/file.txt' as FilePath);
 *
 * // Write a file
 * await fs.write('/path/to/file.txt' as FilePath, 'Hello, World!');
 *
 * // List directory
 * const entries = await fs.list('/path/to/dir' as DirPath);
 * ```
 */
export class TauriFileSystem implements IFileSystem {
  /**
   * Create a new TauriFileSystem instance.
   *
   * @param basePath - Optional base path to prepend to all operations.
   *                   Useful for sandboxing operations to a specific directory.
   */
  constructor(private basePath: string = '') {}

  /**
   * Resolve a path relative to the base path.
   */
  private resolve(path: string): string {
    const normalized = normalizePath(path);
    if (this.basePath) {
      return `${this.basePath}/${normalized}`.replace(/\/+/g, '/');
    }
    return normalized;
  }

  // ============================================================
  // Read Operations
  // ============================================================

  async read(path: FilePath): Promise<Uint8Array> {
    const fullPath = this.resolve(path);
    // With tauri::ipc::Response, Tauri returns raw bytes directly.
    return secureInvoke<Uint8Array>('read_file', { path: fullPath });
  }

  async readText(path: FilePath): Promise<string> {
    const bytes = await this.read(path);
    return new TextDecoder().decode(bytes);
  }

  // ============================================================
  // Write Operations
  // ============================================================

  async write(path: FilePath, content: Uint8Array | string): Promise<void> {
    const fullPath = this.resolve(path);
    const data =
      typeof content === 'string'
        ? Array.from(new TextEncoder().encode(content))
        : Array.from(content);
    await secureInvoke('write_file', { path: fullPath, data });
  }

  async append(path: FilePath, content: Uint8Array | string): Promise<void> {
    // Read existing content, append, write back
    // Note: Could be optimized with a native append command
    let existing: Uint8Array;
    try {
      existing = await this.read(path);
    } catch {
      existing = new Uint8Array(0);
    }

    const newContent = typeof content === 'string' ? new TextEncoder().encode(content) : content;

    const combined = new Uint8Array(existing.length + newContent.length);
    combined.set(existing);
    combined.set(newContent, existing.length);

    await this.write(path, combined);
  }

  // ============================================================
  // Delete Operations
  // ============================================================

  async delete(path: FilePath, options?: DeleteOptions): Promise<void> {
    const fullPath = this.resolve(path);
    await secureInvoke('delete_path', {
      path: fullPath,
      move_to_trash: options?.trash ?? true,
    });
  }

  // ============================================================
  // Query Operations
  // ============================================================

  async exists(path: FilePath | DirPath): Promise<boolean> {
    // Use tauri-plugin-fs exists functionality
    try {
      const { exists } = await import('@tauri-apps/plugin-fs');
      const fullPath = this.resolve(path);
      return await exists(fullPath);
    } catch {
      // Fallback: try to read and catch error
      try {
        await this.read(path as FilePath);
        return true;
      } catch {
        return false;
      }
    }
  }

  async stat(path: FilePath | DirPath): Promise<FileStat> {
    // Use tauri-plugin-fs stat functionality
    const { stat } = await import('@tauri-apps/plugin-fs');
    const fullPath = this.resolve(path);
    const metadata = await stat(fullPath);

    return {
      size: metadata.size,
      created: metadata.birthtime?.getTime() ?? 0,
      modified: metadata.mtime?.getTime() ?? 0,
      isDirectory: metadata.isDirectory,
      isFile: metadata.isFile,
      isSymlink: metadata.isSymlink,
    };
  }

  // ============================================================
  // Directory Operations
  // ============================================================

  async list(dir: DirPath): Promise<FileEntry[]> {
    // Use tauri-plugin-fs readDir functionality
    const { readDir, stat } = await import('@tauri-apps/plugin-fs');
    const fullPath = this.resolve(dir);
    const entries = await readDir(fullPath);

    const result: FileEntry[] = [];
    for (const entry of entries) {
      const entryPath = `${fullPath}/${entry.name}`.replace(/\/+/g, '/');
      try {
        const entryStat = await stat(entryPath);
        result.push({
          name: entry.name,
          path: entryPath as FilePath,
          isDirectory: entryStat.isDirectory,
          isFile: entryStat.isFile,
          isSymlink: entryStat.isSymlink,
        });
      } catch {
        // Skip entries we can't stat
        result.push({
          name: entry.name,
          path: entryPath as FilePath,
          isDirectory: entry.isDirectory ?? false,
          isFile: entry.isFile ?? true,
          isSymlink: entry.isSymlink ?? false,
        });
      }
    }

    return result;
  }

  async mkdir(dir: DirPath, options?: MkdirOptions): Promise<void> {
    const fullPath = this.resolve(dir);

    if (options?.recursive) {
      // create_folder already creates parent directories
      await secureInvoke('create_folder', { path: fullPath });
    } else {
      // For non-recursive, use tauri-plugin-fs mkdir
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      await mkdir(fullPath);
    }
  }

  async rmdir(dir: DirPath, options?: RmdirOptions): Promise<void> {
    const fullPath = this.resolve(dir);

    if (options?.recursive) {
      // delete_path handles recursive deletion for directories
      await secureInvoke('delete_path', {
        path: fullPath,
        move_to_trash: false,
      });
    } else {
      // For non-recursive, use tauri-plugin-fs remove
      const { remove } = await import('@tauri-apps/plugin-fs');
      await remove(fullPath);
    }
  }

  // ============================================================
  // Move/Copy Operations
  // ============================================================

  async rename(from: FilePath, to: FilePath): Promise<void> {
    const fromPath = this.resolve(from);
    const toPath = this.resolve(to);
    await secureInvoke('rename_path', { old_path: fromPath, new_path: toPath });
  }

  async copy(from: FilePath, to: FilePath): Promise<void> {
    const fromPath = this.resolve(from);
    const toPath = this.resolve(to);
    await secureInvoke('copy_file', { source: fromPath, dest: toPath });
  }

  // ============================================================
  // Watch Operations
  // ============================================================

  watch(path: FilePath | DirPath, callback: WatchCallback): Unsubscribe {
    // Use tauri-plugin-fs watch functionality
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const { watch } = await import('@tauri-apps/plugin-fs');
        const fullPath = this.resolve(path);

        const unwatch = await watch(fullPath, (event) => {
          // Map tauri-plugin-fs events to our WatchEvent type
          const watchEvent = this.mapWatchEvent(event);
          if (watchEvent) {
            callback(watchEvent);
          }
        });

        cleanup = () => {
          unwatch();
        };
      } catch (e) {
        console.error('Failed to set up file watch:', e);
      }
    })();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }

  /**
   * Map tauri-plugin-fs watch events to our WatchEvent type.
   */
  private mapWatchEvent(event: unknown): WatchEvent | null {
    // The tauri-plugin-fs watch event structure
    const e = event as { type?: string; paths?: string[] };

    if (!e.type || !e.paths || e.paths.length === 0) {
      return null;
    }

    const eventPath = e.paths[0] as FilePath;

    switch (e.type) {
      case 'create':
        return { type: 'create', path: eventPath };
      case 'modify':
        return { type: 'modify', path: eventPath };
      case 'remove':
        return { type: 'delete', path: eventPath };
      default:
        return null;
    }
  }
}

/**
 * Re-export isTauri for convenience.
 */
export { isTauri };
