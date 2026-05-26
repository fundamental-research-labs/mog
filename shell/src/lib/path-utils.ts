/**
 * Path Utilities
 *
 * Cross-platform path manipulation utilities.
 * All functions handle both forward slashes (/) and backslashes (\).
 */

/**
 * Get the file name from a path.
 *
 * @example
 * getFileName('/path/to/file.txt') // 'file.txt'
 * getFileName('C:\\Users\\file.txt') // 'file.txt'
 */
export function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/**
 * Get the folder name (last segment) from a path.
 * Alias for getFileName, but semantically for directories.
 *
 * @example
 * getFolderName('/path/to/folder') // 'folder'
 */
export function getFolderName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/**
 * Get the parent directory of a path.
 *
 * @example
 * getDirectory('/path/to/file.txt') // '/path/to'
 * getDirectory('C:\\Users\\file.txt') // 'C:\\Users'
 */
export function getDirectory(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSlash >= 0 ? path.substring(0, lastSlash) : path;
}

/**
 * Alias for getDirectory for semantic clarity.
 */
export const getParentDirectory = getDirectory;

/**
 * Get the file extension (without the dot).
 * Returns empty string if no extension.
 *
 * @example
 * getExtension('/path/to/file.txt') // 'txt'
 * getExtension('/path/to/file.TAR.GZ') // 'gz'
 * getExtension('/path/to/file') // ''
 */
export function getExtension(path: string): string {
  const name = getFileName(path);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.substring(dotIndex + 1).toLowerCase() : '';
}

/**
 * Normalize a path for comparison.
 * Converts backslashes to forward slashes and lowercases.
 *
 * @example
 * normalizePath('C:\\Users\\File.txt') // 'c:/users/file.txt'
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * Join path segments.
 * Uses forward slash as separator.
 *
 * @example
 * joinPath('/path/to', 'file.txt') // '/path/to/file.txt'
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((s, i) => {
      // Remove trailing slashes except for first segment
      if (i > 0) s = s.replace(/^[/\\]+/, '');
      // Remove leading slashes except for last segment
      if (i < segments.length - 1) s = s.replace(/[/\\]+$/, '');
      return s;
    })
    .filter(Boolean)
    .join('/');
}

/**
 * Check if a path is within a parent directory.
 *
 * @example
 * isPathWithin('/project/src/file.txt', '/project') // true
 * isPathWithin('/other/file.txt', '/project') // false
 */
export function isPathWithin(childPath: string, parentPath: string): boolean {
  const normalizedChild = normalizePath(childPath);
  const normalizedParent = normalizePath(parentPath);
  return normalizedChild.startsWith(normalizedParent + '/') || normalizedChild === normalizedParent;
}
