import { KernelError } from '../../errors';
import { getDirname, isAbsolute, normalizePath } from './paths';

/**
 * Validates a path for sandbox safety.
 * Returns the validated and normalized path, or throws on invalid input.
 */
export function validatePath(path: string, allowAbsolute = false): string {
  if (!path || typeof path !== 'string') {
    throw new KernelError('FS_INVALID_PATH', 'Invalid path: must be a non-empty string');
  }

  const normalized = normalizePath(path);

  // Check for absolute paths
  if (isAbsolute(normalized) && !allowAbsolute) {
    throw new KernelError('FS_INVALID_PATH', `Absolute paths not allowed: ${path}`);
  }

  // Check for null bytes (potential security issue)
  if (path.includes('\0')) {
    throw new KernelError('FS_INVALID_PATH', `Invalid path: contains null bytes`);
  }

  // Check for reserved names on Windows
  const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  const basename = normalized.split('/').pop() || '';
  if (reservedNames.test(basename)) {
    throw new KernelError('FS_INVALID_PATH', `Invalid path: reserved name ${basename}`);
  }

  return normalized;
}

/**
 * Check if a path would escape from a root directory.
 */
export function wouldEscapeRoot(path: string, _root: string): boolean {
  const normalized = normalizePath(path);

  // Resolve .. segments
  const parts = normalized.split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '..') {
      if (resolved.length === 0) {
        return true; // Would go above root
      }
      resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }

  return false;
}

/**
 * Get all parent directories of a path.
 */
export function getParentDirectories(path: string): string[] {
  const parents: string[] = [];
  let current = getDirname(path);

  while (current && current !== '/' && current !== '.') {
    parents.push(current);
    current = getDirname(current);
  }

  return parents.reverse();
}

/**
 * Check if path matches a glob pattern (simplified).
 * Supports * (any chars except /) and ** (any chars including /).
 */
export function matchesPattern(path: string, pattern: string): boolean {
  // Escape regex special chars except *
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(path);
}
