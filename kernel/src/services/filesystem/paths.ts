/**
 * Type-safe path utilities for Spreadsheet OS filesystem.
 *
 * Uses branded types to distinguish between file paths and directory paths
 * at compile time, preventing common path-related bugs.
 *
 * Extracted from @mog-sdk/contracts/filesystem.
 */

// ============================================================
// Branded Types
// ============================================================

/**
 * Brand symbol for file paths.
 * @internal
 */
declare const FilePathBrand: unique symbol;

/**
 * Brand symbol for directory paths.
 * @internal
 */
declare const DirPathBrand: unique symbol;

/**
 * A branded string type representing a file path.
 * Use `filePath()` to create instances.
 */
export type FilePath = string & { readonly [FilePathBrand]: never };

/**
 * A branded string type representing a directory path.
 * Use `dirPath()` to create instances.
 */
export type DirPath = string & { readonly [DirPathBrand]: never };

/**
 * Union type for any path (file or directory).
 */
export type AnyPath = FilePath | DirPath;

// ============================================================
// Path Constructors
// ============================================================

/**
 * Create a type-safe file path from a string.
 *
 * Note: This does not validate the path exists or is actually a file.
 * It only provides type safety.
 *
 * @param path - The path string
 * @returns A branded FilePath
 *
 * @example
 * ```ts
 * const path = filePath('/home/user/document.xlsx');
 * await fs.read(path); // Type-safe!
 * ```
 */
export function filePath(path: string): FilePath {
  return normalizePath(path) as FilePath;
}

/**
 * Create a type-safe directory path from a string.
 *
 * Note: This does not validate the path exists or is actually a directory.
 * It only provides type safety.
 *
 * @param path - The path string
 * @returns A branded DirPath
 *
 * @example
 * ```ts
 * const dir = dirPath('/home/user/documents');
 * await fs.list(dir); // Type-safe!
 * ```
 */
export function dirPath(path: string): DirPath {
  return normalizePath(path) as DirPath;
}

// ============================================================
// Path Normalization
// ============================================================

/**
 * Normalize a path string.
 *
 * - Converts backslashes to forward slashes
 * - Removes trailing slashes (except for root)
 * - Collapses multiple consecutive slashes
 *
 * @param path - The path to normalize
 * @returns Normalized path string
 *
 * @example
 * ```ts
 * normalizePath('C:\\Users\\foo\\') // 'C:/Users/foo'
 * normalizePath('/home//user///docs/') // '/home/user/docs'
 * normalizePath('/') // '/'
 * ```
 */
export function normalizePath(path: string): string {
  if (!path) {
    return '';
  }

  // Convert backslashes to forward slashes (Windows support)
  let normalized = path.replace(/\\/g, '/');

  // Collapse multiple consecutive slashes
  normalized = normalized.replace(/\/+/g, '/');

  // Remove trailing slash (but keep root '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

// ============================================================
// Path Queries
// ============================================================

/**
 * Check if a path is absolute.
 *
 * - Unix: starts with /
 * - Windows: starts with drive letter (C:, D:, etc.)
 *
 * @param path - The path to check
 * @returns true if the path is absolute
 *
 * @example
 * ```ts
 * isAbsolute('/home/user') // true
 * isAbsolute('C:/Users') // true
 * isAbsolute('./relative') // false
 * isAbsolute('relative') // false
 * ```
 */
export function isAbsolute(path: string): boolean {
  if (!path) {
    return false;
  }
  // Unix absolute path
  if (path.startsWith('/')) {
    return true;
  }
  // Windows absolute path (C:, D:, etc.)
  if (/^[A-Za-z]:/.test(path)) {
    return true;
  }
  return false;
}

/**
 * Check if a path is relative.
 *
 * @param path - The path to check
 * @returns true if the path is relative
 */
export function isRelative(path: string): boolean {
  return !isAbsolute(path);
}

// ============================================================
// Path Manipulation
// ============================================================

/**
 * Join multiple path segments into a single path.
 *
 * Does not resolve '..' or '.' segments.
 * For resolution, use `resolvePath`.
 *
 * @param parts - Path segments to join
 * @returns Joined path string
 *
 * @example
 * ```ts
 * joinPath('/home', 'user', 'docs') // '/home/user/docs'
 * joinPath('foo', 'bar', 'baz.txt') // 'foo/bar/baz.txt'
 * ```
 */
export function joinPath(...parts: string[]): string {
  if (parts.length === 0) {
    return '';
  }

  const joined = parts
    .filter((part) => part !== '')
    .join('/')
    .replace(/\/+/g, '/');

  return joined;
}

/**
 * Resolve a path, handling '..' and '.' segments.
 *
 * @param basePath - The base path
 * @param relativePath - The relative path to resolve
 * @returns Resolved absolute path
 *
 * @example
 * ```ts
 * resolvePath('/home/user', '../other') // '/home/other'
 * resolvePath('/home/user', './docs') // '/home/user/docs'
 * ```
 */
export function resolvePath(basePath: string, relativePath: string): string {
  // If relative path is actually absolute, return it normalized
  if (isAbsolute(relativePath)) {
    return normalizePath(relativePath);
  }

  const base = normalizePath(basePath);
  const relative = normalizePath(relativePath);

  const parts = base.split('/').filter((p) => p !== '');
  const relativeParts = relative.split('/').filter((p) => p !== '');

  for (const part of relativeParts) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.') {
      parts.push(part);
    }
  }

  const result = '/' + parts.join('/');
  return normalizePath(result);
}

/**
 * Get the file or directory name from a path.
 *
 * @param path - The path
 * @returns The basename (last segment of the path)
 *
 * @example
 * ```ts
 * getBasename('/home/user/document.xlsx') // 'document.xlsx'
 * getBasename('/home/user/') // 'user'
 * getBasename('/') // ''
 * ```
 */
export function getBasename(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/' || normalized === '') {
    return '';
  }
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Get the parent directory from a path.
 *
 * @param path - The path
 * @returns The parent directory path
 *
 * @example
 * ```ts
 * getDirname('/home/user/document.xlsx') // '/home/user'
 * getDirname('/home/user') // '/home'
 * getDirname('/') // '/'
 * ```
 */
export function getDirname(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/' || normalized === '') {
    return '/';
  }
  const parts = normalized.split('/');
  parts.pop();
  const dirname = parts.join('/');
  return dirname || '/';
}

/**
 * Get the file extension from a path.
 *
 * Returns empty string if no extension.
 * Includes the leading dot.
 *
 * @param path - The path
 * @returns The file extension (including dot) or empty string
 *
 * @example
 * ```ts
 * getExtension('/home/user/document.xlsx') // '.xlsx'
 * getExtension('/home/user/file.tar.gz') // '.gz'
 * getExtension('/home/user/README') // ''
 * getExtension('/home/user/.gitignore') // ''
 * ```
 */
export function getExtension(path: string): string {
  const basename = getBasename(path);
  if (!basename) {
    return '';
  }

  // Handle dotfiles (e.g., .gitignore has no extension)
  const dotIndex = basename.lastIndexOf('.');
  if (dotIndex <= 0) {
    return '';
  }

  return basename.slice(dotIndex);
}

/**
 * Get the filename without extension.
 *
 * @param path - The path
 * @returns The filename without extension
 *
 * @example
 * ```ts
 * getStem('/home/user/document.xlsx') // 'document'
 * getStem('/home/user/file.tar.gz') // 'file.tar'
 * getStem('/home/user/README') // 'README'
 * ```
 */
export function getStem(path: string): string {
  const basename = getBasename(path);
  const ext = getExtension(path);
  if (!ext) {
    return basename;
  }
  return basename.slice(0, -ext.length);
}

/**
 * Change the file extension of a path.
 *
 * @param path - The original path
 * @param newExt - The new extension (with or without leading dot)
 * @returns Path with new extension
 *
 * @example
 * ```ts
 * changeExtension('/docs/file.xlsx', '.csv') // '/docs/file.csv'
 * changeExtension('/docs/file.xlsx', 'json') // '/docs/file.json'
 * ```
 */
export function changeExtension(path: string, newExt: string): string {
  const dir = getDirname(path);
  const stem = getStem(path);
  const ext = newExt.startsWith('.') ? newExt : '.' + newExt;
  return joinPath(dir, stem + ext);
}

// ============================================================
// Path Comparison
// ============================================================

/**
 * Check if two paths are equal (after normalization).
 *
 * @param path1 - First path
 * @param path2 - Second path
 * @returns true if paths are equal
 */
export function pathsEqual(path1: string, path2: string): boolean {
  return normalizePath(path1) === normalizePath(path2);
}

/**
 * Check if a path is under a given directory.
 *
 * @param path - The path to check
 * @param dir - The directory to check against
 * @returns true if path is under dir
 *
 * @example
 * ```ts
 * isUnder('/home/user/docs/file.txt', '/home/user') // true
 * isUnder('/home/user', '/home/user') // false (same path)
 * isUnder('/home/other/file.txt', '/home/user') // false
 * ```
 */
export function isUnder(path: string, dir: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedDir = normalizePath(dir);

  if (normalizedPath === normalizedDir) {
    return false;
  }

  const dirWithSlash = normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/';

  return normalizedPath.startsWith(dirWithSlash);
}

/**
 * Get the relative path from one path to another.
 *
 * @param from - The source path
 * @param to - The target path
 * @returns The relative path from source to target
 *
 * @example
 * ```ts
 * relativePath('/home/user', '/home/user/docs/file.txt') // 'docs/file.txt'
 * relativePath('/home/user/docs', '/home/other') // '../../other'
 * ```
 */
export function relativePath(from: string, to: string): string {
  const fromParts = normalizePath(from)
    .split('/')
    .filter((p) => p !== '');
  const toParts = normalizePath(to)
    .split('/')
    .filter((p) => p !== '');

  // Find common prefix length
  let commonLength = 0;
  const minLength = Math.min(fromParts.length, toParts.length);
  for (let i = 0; i < minLength; i++) {
    if (fromParts[i] === toParts[i]) {
      commonLength++;
    } else {
      break;
    }
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const upParts = Array(upCount).fill('..');
  const downParts = toParts.slice(commonLength);

  const relativeParts = [...upParts, ...downParts];
  return relativeParts.length > 0 ? relativeParts.join('/') : '.';
}
