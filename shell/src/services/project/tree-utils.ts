/**
 * Tree Utilities
 *
 * Pure functions for manipulating ProjectFileEntry trees.
 * All functions are immutable - they return new arrays/objects.
 */

import type { ProjectFileEntry } from './types';

// =============================================================================
// SEARCH
// =============================================================================

/**
 * Find an entry by path in the tree.
 *
 * @param entries - The tree to search
 * @param path - The path to find
 * @returns The entry if found, null otherwise
 */
export function findEntry(entries: ProjectFileEntry[], path: string): ProjectFileEntry | null {
  for (const entry of entries) {
    if (entry.path === path) {
      return entry;
    }
    if (entry.children) {
      const found = findEntry(entry.children, path);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// =============================================================================
// MUTATIONS (IMMUTABLE)
// =============================================================================

/**
 * Update an entry by path (immutable).
 *
 * @param entries - The tree to update
 * @param path - The path of the entry to update
 * @param updater - Function that returns the updated entry
 * @returns New tree with the entry updated
 */
export function updateEntry(
  entries: ProjectFileEntry[],
  path: string,
  updater: (entry: ProjectFileEntry) => ProjectFileEntry,
): ProjectFileEntry[] {
  return entries.map((entry) => {
    if (entry.path === path) {
      return updater(entry);
    }
    if (entry.children) {
      return {
        ...entry,
        children: updateEntry(entry.children, path, updater),
      };
    }
    return entry;
  });
}

/**
 * Remove an entry by path (immutable).
 *
 * @param entries - The tree to update
 * @param path - The path of the entry to remove
 * @returns New tree with the entry removed
 */
export function removeEntry(entries: ProjectFileEntry[], path: string): ProjectFileEntry[] {
  return entries
    .filter((entry) => entry.path !== path)
    .map((entry) => {
      if (entry.children) {
        return {
          ...entry,
          children: removeEntry(entry.children, path),
        };
      }
      return entry;
    });
}

/**
 * Insert an entry into a parent folder (immutable).
 *
 * @param entries - The tree to update
 * @param parentPath - The path of the parent folder, or null to insert at root
 * @param newEntry - The entry to insert
 * @returns New tree with the entry inserted
 */
export function insertEntry(
  entries: ProjectFileEntry[],
  parentPath: string | null,
  newEntry: ProjectFileEntry,
): ProjectFileEntry[] {
  if (parentPath === null) {
    return [...entries, newEntry];
  }
  return entries.map((entry) => {
    if (entry.path === parentPath && entry.isDirectory) {
      return {
        ...entry,
        children: [...(entry.children || []), newEntry],
      };
    }
    if (entry.children) {
      return {
        ...entry,
        children: insertEntry(entry.children, parentPath, newEntry),
      };
    }
    return entry;
  });
}

// =============================================================================
// EXPANSION STATE
// =============================================================================

/**
 * Toggle the expanded state of a folder.
 *
 * @param entries - The tree to update
 * @param path - The path of the folder to toggle
 * @returns New tree with the folder's expanded state toggled
 */
export function toggleExpanded(entries: ProjectFileEntry[], path: string): ProjectFileEntry[] {
  return updateEntry(entries, path, (entry) => ({
    ...entry,
    isExpanded: !entry.isExpanded,
  }));
}

/**
 * Collect all expanded folder paths from a tree.
 * Useful for preserving expansion state across tree refreshes.
 *
 * @param entries - The tree to scan
 * @returns Set of expanded folder paths
 */
export function collectExpandedPaths(entries: ProjectFileEntry[]): Set<string> {
  const paths = new Set<string>();

  const collect = (items: ProjectFileEntry[]): void => {
    for (const entry of items) {
      if (entry.isDirectory && entry.isExpanded) {
        paths.add(entry.path);
      }
      if (entry.children) {
        collect(entry.children);
      }
    }
  };

  collect(entries);
  return paths;
}

/**
 * Restore expanded state from a set of paths.
 * Useful for restoring expansion state after tree refresh.
 *
 * @param entries - The tree to update
 * @param expandedPaths - Set of paths that should be expanded
 * @returns New tree with expanded state restored
 */
export function restoreExpandedState(
  entries: ProjectFileEntry[],
  expandedPaths: Set<string>,
): ProjectFileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    isExpanded: expandedPaths.has(entry.path),
    children: entry.children ? restoreExpandedState(entry.children, expandedPaths) : undefined,
  }));
}

// =============================================================================
// SORTING
// =============================================================================

/**
 * Sort entries: folders first, then alphabetically by name.
 *
 * @param entries - The entries to sort (sorts recursively)
 * @returns New sorted array
 */
export function sortEntries(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  return [...entries]
    .sort((a, b) => {
      // Folders first
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      // Then alphabetically (case-insensitive)
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    })
    .map((entry) => {
      if (entry.children) {
        return {
          ...entry,
          children: sortEntries(entry.children),
        };
      }
      return entry;
    });
}

// =============================================================================
// TRAVERSAL
// =============================================================================

/**
 * Flatten the tree into a list of all entries.
 *
 * @param entries - The tree to flatten
 * @returns Array of all entries in depth-first order
 */
export function flattenEntries(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  const result: ProjectFileEntry[] = [];

  const flatten = (items: ProjectFileEntry[]): void => {
    for (const entry of items) {
      result.push(entry);
      if (entry.children) {
        flatten(entry.children);
      }
    }
  };

  flatten(entries);
  return result;
}

/**
 * Find all file entries (non-directories) in the tree.
 *
 * @param entries - The tree to search
 * @returns Array of all file entries
 */
export function findAllFiles(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  return flattenEntries(entries).filter((entry) => !entry.isDirectory);
}

/**
 * Find all folder entries (directories) in the tree.
 *
 * @param entries - The tree to search
 * @returns Array of all folder entries
 */
export function findAllFolders(entries: ProjectFileEntry[]): ProjectFileEntry[] {
  return flattenEntries(entries).filter((entry) => entry.isDirectory);
}
