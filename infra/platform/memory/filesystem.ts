import type { DirPath, FilePath } from '@mog-sdk/contracts/filesystem';
import {
  DirectoryExistsError,
  DirectoryNotEmptyError,
  DirectoryNotFoundError,
  FileExistsError,
  FileNotFoundError,
  IsDirectoryError,
  NotDirectoryError,
} from '@mog/platform/filesystem-errors';
import { getBasename, getDirname, joinPath, normalizePath } from '@mog/platform/filesystem-paths';
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

interface MemoryNode {
  type: 'file' | 'directory';
  content?: Uint8Array; // Only for files
  created: number;
  modified: number;
  children?: Set<string>; // Only for directories
}

/**
 * In-memory filesystem for unit tests.
 * No I/O dependencies - everything stored in a Map.
 *
 * @example
 * ```ts
 * const fs = new MemoryFileSystem();
 * await fs.mkdir('/docs' as DirPath);
 * await fs.write('/docs/readme.txt' as FilePath, 'Hello World');
 * const content = await fs.readText('/docs/readme.txt' as FilePath);
 * console.log(content); // 'Hello World'
 * ```
 */
export class MemoryFileSystem implements IFileSystem {
  private nodes: Map<string, MemoryNode> = new Map();
  private watchers: Map<string, Set<WatchCallback>> = new Map();

  constructor() {
    // Create root directory
    this.nodes.set('/', {
      type: 'directory',
      created: Date.now(),
      modified: Date.now(),
      children: new Set(),
    });
  }

  // ============================================================
  // Read Operations
  // ============================================================

  async read(path: FilePath): Promise<Uint8Array> {
    const normalized = normalizePath(path);
    const node = this.nodes.get(normalized);

    if (!node) {
      throw new FileNotFoundError(path);
    }
    if (node.type !== 'file') {
      throw new IsDirectoryError(path);
    }

    return node.content!;
  }

  async readText(path: FilePath): Promise<string> {
    const bytes = await this.read(path);
    return new TextDecoder().decode(bytes);
  }

  // ============================================================
  // Write Operations
  // ============================================================

  async write(path: FilePath, content: Uint8Array | string): Promise<void> {
    const normalized = normalizePath(path);
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;

    // Ensure parent directory exists
    const dir = getDirname(normalized);
    if (dir && dir !== '/' && !this.nodes.has(dir)) {
      throw new DirectoryNotFoundError(dir);
    }

    const now = Date.now();
    const existing = this.nodes.get(normalized);

    if (existing && existing.type === 'directory') {
      throw new IsDirectoryError(path);
    }

    const isNew = !existing;

    this.nodes.set(normalized, {
      type: 'file',
      content: data,
      created: existing?.created ?? now,
      modified: now,
    });

    // Add to parent's children
    if (dir) {
      const parentNode = this.nodes.get(dir);
      if (parentNode && parentNode.type === 'directory') {
        parentNode.children!.add(getBasename(normalized));
      }
    }

    // Notify watchers
    this.notifyWatchers(normalized as FilePath, isNew ? 'create' : 'modify');
  }

  async append(path: FilePath, content: Uint8Array | string): Promise<void> {
    const normalized = normalizePath(path);
    const existing = this.nodes.get(normalized);

    // Ensure parent directory exists for new files
    const dir = getDirname(normalized);
    if (!existing && dir && dir !== '/' && !this.nodes.has(dir)) {
      throw new DirectoryNotFoundError(dir);
    }

    if (!existing) {
      // Create new file
      await this.write(path, content);
      return;
    }

    if (existing.type !== 'file') {
      throw new IsDirectoryError(path);
    }

    const newContent = typeof content === 'string' ? new TextEncoder().encode(content) : content;

    const combined = new Uint8Array(existing.content!.length + newContent.length);
    combined.set(existing.content!);
    combined.set(newContent, existing.content!.length);

    existing.content = combined;
    existing.modified = Date.now();

    this.notifyWatchers(normalized as FilePath, 'modify');
  }

  // ============================================================
  // Delete Operations
  // ============================================================

  async delete(path: FilePath, _options?: DeleteOptions): Promise<void> {
    const normalized = normalizePath(path);
    const node = this.nodes.get(normalized);

    if (!node) {
      throw new FileNotFoundError(path);
    }

    if (node.type === 'directory') {
      throw new IsDirectoryError(path);
    }

    // Remove from parent's children
    const dir = getDirname(normalized);
    if (dir) {
      const parentNode = this.nodes.get(dir);
      if (parentNode && parentNode.type === 'directory') {
        parentNode.children!.delete(getBasename(normalized));
      }
    }

    this.nodes.delete(normalized);
    this.notifyWatchers(normalized as FilePath, 'delete');
  }

  // ============================================================
  // Query Operations
  // ============================================================

  async exists(path: FilePath | DirPath): Promise<boolean> {
    return this.nodes.has(normalizePath(path));
  }

  async stat(path: FilePath | DirPath): Promise<FileStat> {
    const normalized = normalizePath(path);
    const node = this.nodes.get(normalized);

    if (!node) {
      throw new FileNotFoundError(path);
    }

    return {
      size: node.content?.length ?? 0,
      created: node.created,
      modified: node.modified,
      isDirectory: node.type === 'directory',
      isFile: node.type === 'file',
      isSymlink: false,
    };
  }

  // ============================================================
  // Directory Operations
  // ============================================================

  async list(dir: DirPath): Promise<FileEntry[]> {
    const normalized = normalizePath(dir);
    const node = this.nodes.get(normalized);

    if (!node) {
      throw new DirectoryNotFoundError(dir);
    }
    if (node.type !== 'directory') {
      throw new NotDirectoryError(dir);
    }

    const entries: FileEntry[] = [];
    for (const name of node.children!) {
      const childPath = joinPath(normalized, name);
      const childNode = this.nodes.get(childPath);
      if (childNode) {
        entries.push({
          name,
          path: childPath as FilePath,
          isDirectory: childNode.type === 'directory',
          isFile: childNode.type === 'file',
          isSymlink: false,
        });
      }
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdir(dir: DirPath, options?: MkdirOptions): Promise<void> {
    const normalized = normalizePath(dir);

    if (this.nodes.has(normalized)) {
      throw new DirectoryExistsError(dir);
    }

    const parent = getDirname(normalized);
    if (parent && parent !== '/' && !this.nodes.has(parent)) {
      if (options?.recursive) {
        await this.mkdir(parent as DirPath, { recursive: true });
      } else {
        throw new DirectoryNotFoundError(parent);
      }
    }

    const now = Date.now();
    this.nodes.set(normalized, {
      type: 'directory',
      created: now,
      modified: now,
      children: new Set(),
    });

    // Add to parent's children
    if (parent) {
      const parentNode = this.nodes.get(parent);
      if (parentNode && parentNode.type === 'directory') {
        parentNode.children!.add(getBasename(normalized));
      }
    }
  }

  async rmdir(dir: DirPath, options?: RmdirOptions): Promise<void> {
    const normalized = normalizePath(dir);
    const node = this.nodes.get(normalized);

    if (!node) {
      throw new DirectoryNotFoundError(dir);
    }
    if (node.type !== 'directory') {
      throw new NotDirectoryError(dir);
    }
    if (node.children!.size > 0 && !options?.recursive) {
      throw new DirectoryNotEmptyError(dir);
    }

    // Recursively delete children
    if (options?.recursive) {
      for (const name of Array.from(node.children!)) {
        const childPath = joinPath(normalized, name);
        const childNode = this.nodes.get(childPath);
        if (childNode?.type === 'directory') {
          await this.rmdir(childPath as DirPath, { recursive: true });
        } else {
          await this.delete(childPath as FilePath);
        }
      }
    }

    // Remove from parent
    const parent = getDirname(normalized);
    if (parent) {
      const parentNode = this.nodes.get(parent);
      if (parentNode && parentNode.type === 'directory') {
        parentNode.children!.delete(getBasename(normalized));
      }
    }

    this.nodes.delete(normalized);
  }

  // ============================================================
  // Move/Copy Operations
  // ============================================================

  async rename(from: FilePath, to: FilePath): Promise<void> {
    const fromNorm = normalizePath(from);
    const toNorm = normalizePath(to);

    const node = this.nodes.get(fromNorm);
    if (!node) {
      throw new FileNotFoundError(from);
    }

    if (this.nodes.has(toNorm)) {
      throw new FileExistsError(to);
    }

    // Ensure destination parent exists
    const toDir = getDirname(toNorm);
    if (toDir && toDir !== '/' && !this.nodes.has(toDir)) {
      throw new DirectoryNotFoundError(toDir);
    }

    // Copy to new location
    this.nodes.set(toNorm, { ...node, modified: Date.now() });

    // Update parent children
    const fromDir = getDirname(fromNorm);

    if (fromDir) {
      const parentNode = this.nodes.get(fromDir);
      if (parentNode?.type === 'directory') {
        parentNode.children!.delete(getBasename(fromNorm));
      }
    }

    if (toDir) {
      const parentNode = this.nodes.get(toDir);
      if (parentNode?.type === 'directory') {
        parentNode.children!.add(getBasename(toNorm));
      }
    }

    this.nodes.delete(fromNorm);

    this.notifyWatchers(fromNorm as FilePath, 'delete');
    this.notifyWatchers(toNorm as FilePath, 'create');
  }

  async copy(from: FilePath, to: FilePath): Promise<void> {
    const fromNorm = normalizePath(from);
    const toNorm = normalizePath(to);

    const node = this.nodes.get(fromNorm);
    if (!node) {
      throw new FileNotFoundError(from);
    }

    if (node.type !== 'file') {
      throw new IsDirectoryError(from);
    }

    if (this.nodes.has(toNorm)) {
      throw new FileExistsError(to);
    }

    // Ensure destination parent exists
    const toDir = getDirname(toNorm);
    if (toDir && toDir !== '/' && !this.nodes.has(toDir)) {
      throw new DirectoryNotFoundError(toDir);
    }

    const content = await this.read(from);
    await this.write(to, content);
  }

  // ============================================================
  // Watch Operations
  // ============================================================

  watch(path: FilePath | DirPath, callback: WatchCallback): Unsubscribe {
    const normalized = normalizePath(path);

    if (!this.watchers.has(normalized)) {
      this.watchers.set(normalized, new Set());
    }
    this.watchers.get(normalized)!.add(callback);

    return () => {
      this.watchers.get(normalized)?.delete(callback);
    };
  }

  private notifyWatchers(path: FilePath, type: 'create' | 'modify' | 'delete'): void {
    // Notify exact path watchers
    const watchers = this.watchers.get(path);
    if (watchers) {
      const event: WatchEvent = { type, path } as WatchEvent;
      for (const cb of watchers) {
        cb(event);
      }
    }

    // Notify parent directory watchers
    const dir = getDirname(path);
    if (dir) {
      const dirWatchers = this.watchers.get(dir);
      if (dirWatchers) {
        const event: WatchEvent = { type, path } as WatchEvent;
        for (const cb of dirWatchers) {
          cb(event);
        }
      }
    }
  }

  // ============================================================
  // Test Helpers
  // ============================================================

  /** Clear all files and directories (except root) */
  clear(): void {
    this.nodes.clear();
    this.nodes.set('/', {
      type: 'directory',
      created: Date.now(),
      modified: Date.now(),
      children: new Set(),
    });
    this.watchers.clear();
  }

  /** Get total number of files and directories */
  size(): number {
    return this.nodes.size - 1; // Exclude root
  }

  /** Dump filesystem structure for debugging */
  dump(): Record<string, 'file' | 'directory'> {
    const result: Record<string, 'file' | 'directory'> = {};
    for (const [path, node] of this.nodes) {
      if (path !== '/') {
        result[path] = node.type;
      }
    }
    return result;
  }
}
