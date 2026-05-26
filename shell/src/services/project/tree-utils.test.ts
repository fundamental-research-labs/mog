/**
 * Tree Utilities Tests
 *
 * Tests for pure functions that manipulate ProjectFileEntry trees.
 * All functions are immutable - they return new arrays/objects.
 */

import {
  collectExpandedPaths,
  findAllFiles,
  findAllFolders,
  findEntry,
  flattenEntries,
  insertEntry,
  removeEntry,
  restoreExpandedState,
  sortEntries,
  toggleExpanded,
  updateEntry,
} from './tree-utils';
import type { ProjectFileEntry } from './types';

// =============================================================================
// TEST FIXTURES
// =============================================================================

/**
 * Creates a test tree structure:
 * /project/
 * ├── src/ (expanded)
 * │   ├── index.ts
 * │   ├── utils.ts
 * │   └── components/ (collapsed)
 * │       └── Button.tsx
 * ├── README.md
 * └── package.json
 */
const createTestTree = (): ProjectFileEntry[] => [
  {
    name: 'src',
    path: '/project/src',
    isDirectory: true,
    isExpanded: true,
    children: [
      { name: 'index.ts', path: '/project/src/index.ts', isDirectory: false },
      { name: 'utils.ts', path: '/project/src/utils.ts', isDirectory: false },
      {
        name: 'components',
        path: '/project/src/components',
        isDirectory: true,
        isExpanded: false,
        children: [
          {
            name: 'Button.tsx',
            path: '/project/src/components/Button.tsx',
            isDirectory: false,
          },
        ],
      },
    ],
  },
  { name: 'README.md', path: '/project/README.md', isDirectory: false },
  { name: 'package.json', path: '/project/package.json', isDirectory: false },
];

// =============================================================================
// SEARCH TESTS
// =============================================================================

describe('tree-utils', () => {
  describe('findEntry', () => {
    it('finds entry at root level', () => {
      const tree = createTestTree();
      const result = findEntry(tree, '/project/README.md');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('README.md');
      expect(result?.isDirectory).toBe(false);
    });

    it('finds entry in nested folder', () => {
      const tree = createTestTree();
      const result = findEntry(tree, '/project/src/components/Button.tsx');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Button.tsx');
    });

    it('finds entry at first level of nesting', () => {
      const tree = createTestTree();
      const result = findEntry(tree, '/project/src/index.ts');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('index.ts');
    });

    it('returns null for non-existent path', () => {
      const tree = createTestTree();
      const result = findEntry(tree, '/project/nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for non-existent nested path', () => {
      const tree = createTestTree();
      const result = findEntry(tree, '/project/src/components/Header.tsx');
      expect(result).toBeNull();
    });

    it('finds directory entry', () => {
      const tree = createTestTree();
      const result = findEntry(tree, '/project/src');
      expect(result).not.toBeNull();
      expect(result?.isDirectory).toBe(true);
      expect(result?.name).toBe('src');
    });

    it('finds nested directory entry', () => {
      const tree = createTestTree();
      const result = findEntry(tree, '/project/src/components');
      expect(result).not.toBeNull();
      expect(result?.isDirectory).toBe(true);
      expect(result?.name).toBe('components');
    });

    it('returns null for empty tree', () => {
      const result = findEntry([], '/project/README.md');
      expect(result).toBeNull();
    });

    it('handles paths with similar prefixes correctly', () => {
      const tree = createTestTree();
      // Should not find /project/src when looking for /project/src-other
      const result = findEntry(tree, '/project/src-other');
      expect(result).toBeNull();
    });
  });

  // =============================================================================
  // MUTATION TESTS (IMMUTABLE)
  // =============================================================================

  describe('updateEntry', () => {
    it('updates entry at root level', () => {
      const tree = createTestTree();
      const result = updateEntry(tree, '/project/README.md', (e) => ({
        ...e,
        name: 'CHANGELOG.md',
      }));
      const updated = findEntry(result, '/project/README.md');
      expect(updated?.name).toBe('CHANGELOG.md');
    });

    it('updates nested entry', () => {
      const tree = createTestTree();
      const result = updateEntry(tree, '/project/src/index.ts', (e) => ({
        ...e,
        name: 'main.ts',
      }));
      const updated = findEntry(result, '/project/src/index.ts');
      expect(updated?.name).toBe('main.ts');
    });

    it('updates deeply nested entry', () => {
      const tree = createTestTree();
      const result = updateEntry(tree, '/project/src/components/Button.tsx', (e) => ({
        ...e,
        name: 'IconButton.tsx',
      }));
      const updated = findEntry(result, '/project/src/components/Button.tsx');
      expect(updated?.name).toBe('IconButton.tsx');
    });

    it('updates directory entry', () => {
      const tree = createTestTree();
      const result = updateEntry(tree, '/project/src', (e) => ({
        ...e,
        name: 'source',
      }));
      const updated = findEntry(result, '/project/src');
      expect(updated?.name).toBe('source');
    });

    it('returns new array (immutable)', () => {
      const tree = createTestTree();
      const result = updateEntry(tree, '/project/README.md', (e) => ({
        ...e,
        name: 'NEW.md',
      }));
      expect(result).not.toBe(tree);
      expect(tree[1].name).toBe('README.md'); // Original unchanged
    });

    it('creates new objects in the path to the updated entry', () => {
      const tree = createTestTree();
      const originalSrc = tree[0];
      const result = updateEntry(tree, '/project/src/index.ts', (e) => ({
        ...e,
        name: 'main.ts',
      }));
      // The src folder object should be different (new reference)
      expect(result[0]).not.toBe(originalSrc);
    });

    it('leaves unrelated branches unchanged', () => {
      const tree = createTestTree();
      const originalReadme = tree[1];
      const result = updateEntry(tree, '/project/src/index.ts', (e) => ({
        ...e,
        name: 'main.ts',
      }));
      // README.md should be the same object reference
      expect(result[1]).toBe(originalReadme);
    });

    it('handles non-existent path gracefully', () => {
      const tree = createTestTree();
      const result = updateEntry(tree, '/nonexistent/path', (e) => ({
        ...e,
        name: 'updated',
      }));
      // Tree structure should be unchanged (but still a new array due to mapping)
      expect(result.length).toBe(tree.length);
    });
  });

  describe('removeEntry', () => {
    it('removes entry at root level', () => {
      const tree = createTestTree();
      const result = removeEntry(tree, '/project/README.md');
      expect(findEntry(result, '/project/README.md')).toBeNull();
      expect(result.length).toBe(2);
    });

    it('removes nested entry', () => {
      const tree = createTestTree();
      const result = removeEntry(tree, '/project/src/utils.ts');
      expect(findEntry(result, '/project/src/utils.ts')).toBeNull();
      // src folder should now have 2 children instead of 3
      const src = findEntry(result, '/project/src');
      expect(src?.children?.length).toBe(2);
    });

    it('removes deeply nested entry', () => {
      const tree = createTestTree();
      const result = removeEntry(tree, '/project/src/components/Button.tsx');
      expect(findEntry(result, '/project/src/components/Button.tsx')).toBeNull();
      // components folder should now be empty
      const components = findEntry(result, '/project/src/components');
      expect(components?.children?.length).toBe(0);
    });

    it('removes directory entry', () => {
      const tree = createTestTree();
      const result = removeEntry(tree, '/project/src/components');
      expect(findEntry(result, '/project/src/components')).toBeNull();
      // Button.tsx should also be gone since its parent was removed
      expect(findEntry(result, '/project/src/components/Button.tsx')).toBeNull();
    });

    it('returns new array (immutable)', () => {
      const tree = createTestTree();
      const result = removeEntry(tree, '/project/README.md');
      expect(result).not.toBe(tree);
      expect(tree.length).toBe(3); // Original unchanged
    });

    it('handles non-existent path gracefully', () => {
      const tree = createTestTree();
      const result = removeEntry(tree, '/nonexistent/path');
      expect(result.length).toBe(tree.length);
    });

    it('removes from empty tree without error', () => {
      const result = removeEntry([], '/project/file.txt');
      expect(result).toEqual([]);
    });
  });

  describe('insertEntry', () => {
    it('inserts at root when parentPath is null', () => {
      const tree = createTestTree();
      const newEntry: ProjectFileEntry = {
        name: 'new.txt',
        path: '/project/new.txt',
        isDirectory: false,
      };
      const result = insertEntry(tree, null, newEntry);
      expect(result.length).toBe(4);
      expect(findEntry(result, '/project/new.txt')).toBeTruthy();
    });

    it('inserts into folder', () => {
      const tree = createTestTree();
      const newEntry: ProjectFileEntry = {
        name: 'new.ts',
        path: '/project/src/new.ts',
        isDirectory: false,
      };
      const result = insertEntry(tree, '/project/src', newEntry);
      expect(findEntry(result, '/project/src/new.ts')).toBeTruthy();
      const src = findEntry(result, '/project/src');
      expect(src?.children?.length).toBe(4);
    });

    it('inserts into nested folder', () => {
      const tree = createTestTree();
      const newEntry: ProjectFileEntry = {
        name: 'Input.tsx',
        path: '/project/src/components/Input.tsx',
        isDirectory: false,
      };
      const result = insertEntry(tree, '/project/src/components', newEntry);
      expect(findEntry(result, '/project/src/components/Input.tsx')).toBeTruthy();
      const components = findEntry(result, '/project/src/components');
      expect(components?.children?.length).toBe(2);
    });

    it('inserts directory into folder', () => {
      const tree = createTestTree();
      const newEntry: ProjectFileEntry = {
        name: 'hooks',
        path: '/project/src/hooks',
        isDirectory: true,
        children: [],
      };
      const result = insertEntry(tree, '/project/src', newEntry);
      const hooks = findEntry(result, '/project/src/hooks');
      expect(hooks).toBeTruthy();
      expect(hooks?.isDirectory).toBe(true);
    });

    it('returns new array (immutable)', () => {
      const tree = createTestTree();
      const newEntry: ProjectFileEntry = {
        name: 'new.txt',
        path: '/project/new.txt',
        isDirectory: false,
      };
      const result = insertEntry(tree, null, newEntry);
      expect(result).not.toBe(tree);
      expect(tree.length).toBe(3); // Original unchanged
    });

    it('creates children array if folder has none', () => {
      const folderWithNoChildren: ProjectFileEntry[] = [
        {
          name: 'empty-folder',
          path: '/project/empty-folder',
          isDirectory: true,
          // No children property
        },
      ];
      const newEntry: ProjectFileEntry = {
        name: 'file.txt',
        path: '/project/empty-folder/file.txt',
        isDirectory: false,
      };
      const result = insertEntry(folderWithNoChildren, '/project/empty-folder', newEntry);
      const folder = findEntry(result, '/project/empty-folder');
      expect(folder?.children?.length).toBe(1);
    });

    it('does not insert into non-directory', () => {
      const tree = createTestTree();
      const newEntry: ProjectFileEntry = {
        name: 'file.txt',
        path: '/project/README.md/file.txt',
        isDirectory: false,
      };
      const result = insertEntry(tree, '/project/README.md', newEntry);
      // Should not have been inserted because README.md is not a directory
      expect(findEntry(result, '/project/README.md/file.txt')).toBeNull();
    });
  });

  // =============================================================================
  // EXPANSION STATE TESTS
  // =============================================================================

  describe('toggleExpanded', () => {
    it('toggles expanded state from true to false', () => {
      const tree = createTestTree();
      const result = toggleExpanded(tree, '/project/src');
      const folder = findEntry(result, '/project/src');
      expect(folder?.isExpanded).toBe(false); // Was true, now false
    });

    it('toggles expanded state from false to true', () => {
      const tree = createTestTree();
      const result = toggleExpanded(tree, '/project/src/components');
      const folder = findEntry(result, '/project/src/components');
      expect(folder?.isExpanded).toBe(true); // Was false, now true
    });

    it('toggles expanded state from undefined to true', () => {
      const treeWithUndefined: ProjectFileEntry[] = [
        {
          name: 'folder',
          path: '/project/folder',
          isDirectory: true,
          children: [],
          // isExpanded is undefined
        },
      ];
      const result = toggleExpanded(treeWithUndefined, '/project/folder');
      const folder = findEntry(result, '/project/folder');
      expect(folder?.isExpanded).toBe(true); // undefined -> true
    });

    it('returns new array (immutable)', () => {
      const tree = createTestTree();
      const result = toggleExpanded(tree, '/project/src');
      expect(result).not.toBe(tree);
      expect(tree[0].isExpanded).toBe(true); // Original unchanged
    });
  });

  describe('collectExpandedPaths', () => {
    it('collects all expanded folder paths', () => {
      const tree = createTestTree();
      const paths = collectExpandedPaths(tree);
      expect(paths.has('/project/src')).toBe(true);
      expect(paths.has('/project/src/components')).toBe(false); // Not expanded
    });

    it('returns empty set for tree with no expanded folders', () => {
      const tree: ProjectFileEntry[] = [
        {
          name: 'folder',
          path: '/folder',
          isDirectory: true,
          isExpanded: false,
          children: [],
        },
      ];
      const paths = collectExpandedPaths(tree);
      expect(paths.size).toBe(0);
    });

    it('returns empty set for empty tree', () => {
      const paths = collectExpandedPaths([]);
      expect(paths.size).toBe(0);
    });

    it('does not include files in expanded paths', () => {
      const tree = createTestTree();
      const paths = collectExpandedPaths(tree);
      expect(paths.has('/project/src/index.ts')).toBe(false);
      expect(paths.has('/project/README.md')).toBe(false);
    });

    it('collects paths from deeply nested expanded folders', () => {
      const deepTree: ProjectFileEntry[] = [
        {
          name: 'a',
          path: '/a',
          isDirectory: true,
          isExpanded: true,
          children: [
            {
              name: 'b',
              path: '/a/b',
              isDirectory: true,
              isExpanded: true,
              children: [
                {
                  name: 'c',
                  path: '/a/b/c',
                  isDirectory: true,
                  isExpanded: true,
                  children: [],
                },
              ],
            },
          ],
        },
      ];
      const paths = collectExpandedPaths(deepTree);
      expect(paths.size).toBe(3);
      expect(paths.has('/a')).toBe(true);
      expect(paths.has('/a/b')).toBe(true);
      expect(paths.has('/a/b/c')).toBe(true);
    });
  });

  describe('restoreExpandedState', () => {
    it('restores expanded state from paths', () => {
      const tree = createTestTree();
      const paths = new Set(['/project/src/components']);
      const result = restoreExpandedState(tree, paths);
      const folder = findEntry(result, '/project/src/components');
      expect(folder?.isExpanded).toBe(true);
    });

    it('collapses folders not in the paths set', () => {
      const tree = createTestTree();
      const paths = new Set(['/project/src/components']);
      const result = restoreExpandedState(tree, paths);
      const src = findEntry(result, '/project/src');
      // src was originally expanded but is not in paths
      expect(src?.isExpanded).toBe(false);
    });

    it('handles empty paths set', () => {
      const tree = createTestTree();
      const paths = new Set<string>();
      const result = restoreExpandedState(tree, paths);
      // All folders should be collapsed
      const src = findEntry(result, '/project/src');
      const components = findEntry(result, '/project/src/components');
      expect(src?.isExpanded).toBe(false);
      expect(components?.isExpanded).toBe(false);
    });

    it('returns new array (immutable)', () => {
      const tree = createTestTree();
      const paths = new Set(['/project/src/components']);
      const result = restoreExpandedState(tree, paths);
      expect(result).not.toBe(tree);
    });

    it('preserves other entry properties', () => {
      const tree = createTestTree();
      const paths = new Set(['/project/src']);
      const result = restoreExpandedState(tree, paths);
      const src = findEntry(result, '/project/src');
      expect(src?.name).toBe('src');
      expect(src?.path).toBe('/project/src');
      expect(src?.isDirectory).toBe(true);
      expect(src?.children).toBeDefined();
    });
  });

  // =============================================================================
  // SORTING TESTS
  // =============================================================================

  describe('sortEntries', () => {
    it('sorts folders before files', () => {
      const unsorted: ProjectFileEntry[] = [
        { name: 'z.txt', path: '/z.txt', isDirectory: false },
        { name: 'a-folder', path: '/a-folder', isDirectory: true, children: [] },
        { name: 'a.txt', path: '/a.txt', isDirectory: false },
      ];
      const result = sortEntries(unsorted);
      expect(result[0].name).toBe('a-folder');
      expect(result[1].name).toBe('a.txt');
      expect(result[2].name).toBe('z.txt');
    });

    it('sorts files alphabetically', () => {
      const unsorted: ProjectFileEntry[] = [
        { name: 'zebra.txt', path: '/zebra.txt', isDirectory: false },
        { name: 'apple.txt', path: '/apple.txt', isDirectory: false },
        { name: 'mango.txt', path: '/mango.txt', isDirectory: false },
      ];
      const result = sortEntries(unsorted);
      expect(result[0].name).toBe('apple.txt');
      expect(result[1].name).toBe('mango.txt');
      expect(result[2].name).toBe('zebra.txt');
    });

    it('sorts folders alphabetically among themselves', () => {
      const unsorted: ProjectFileEntry[] = [
        { name: 'zebra', path: '/zebra', isDirectory: true, children: [] },
        { name: 'apple', path: '/apple', isDirectory: true, children: [] },
        { name: 'mango', path: '/mango', isDirectory: true, children: [] },
      ];
      const result = sortEntries(unsorted);
      expect(result[0].name).toBe('apple');
      expect(result[1].name).toBe('mango');
      expect(result[2].name).toBe('zebra');
    });

    it('sorts case-insensitively', () => {
      const unsorted: ProjectFileEntry[] = [
        { name: 'Zebra.txt', path: '/Zebra.txt', isDirectory: false },
        { name: 'apple.txt', path: '/apple.txt', isDirectory: false },
        { name: 'BANANA.txt', path: '/BANANA.txt', isDirectory: false },
      ];
      const result = sortEntries(unsorted);
      expect(result[0].name).toBe('apple.txt');
      expect(result[1].name).toBe('BANANA.txt');
      expect(result[2].name).toBe('Zebra.txt');
    });

    it('sorts children recursively', () => {
      const unsorted: ProjectFileEntry[] = [
        {
          name: 'folder',
          path: '/folder',
          isDirectory: true,
          children: [
            { name: 'z.txt', path: '/folder/z.txt', isDirectory: false },
            { name: 'a.txt', path: '/folder/a.txt', isDirectory: false },
          ],
        },
      ];
      const result = sortEntries(unsorted);
      expect(result[0].children?.[0].name).toBe('a.txt');
      expect(result[0].children?.[1].name).toBe('z.txt');
    });

    it('returns new array (immutable)', () => {
      const unsorted: ProjectFileEntry[] = [
        { name: 'b.txt', path: '/b.txt', isDirectory: false },
        { name: 'a.txt', path: '/a.txt', isDirectory: false },
      ];
      const result = sortEntries(unsorted);
      expect(result).not.toBe(unsorted);
      expect(unsorted[0].name).toBe('b.txt'); // Original unchanged
    });

    it('handles empty array', () => {
      const result = sortEntries([]);
      expect(result).toEqual([]);
    });

    it('handles single entry', () => {
      const single: ProjectFileEntry[] = [
        { name: 'only.txt', path: '/only.txt', isDirectory: false },
      ];
      const result = sortEntries(single);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('only.txt');
    });
  });

  // =============================================================================
  // TRAVERSAL TESTS
  // =============================================================================

  describe('flattenEntries', () => {
    it('flattens tree to array', () => {
      const tree = createTestTree();
      const result = flattenEntries(tree);
      expect(result.length).toBe(7); // All entries including nested
    });

    it('maintains depth-first order', () => {
      const tree = createTestTree();
      const result = flattenEntries(tree);
      const names = result.map((e) => e.name);
      // Expected order: src, index.ts, utils.ts, components, Button.tsx, README.md, package.json
      expect(names).toEqual([
        'src',
        'index.ts',
        'utils.ts',
        'components',
        'Button.tsx',
        'README.md',
        'package.json',
      ]);
    });

    it('returns empty array for empty tree', () => {
      const result = flattenEntries([]);
      expect(result).toEqual([]);
    });

    it('includes both files and directories', () => {
      const tree = createTestTree();
      const result = flattenEntries(tree);
      const directories = result.filter((e) => e.isDirectory);
      const files = result.filter((e) => !e.isDirectory);
      expect(directories.length).toBe(2); // src, components
      expect(files.length).toBe(5); // index.ts, utils.ts, Button.tsx, README.md, package.json
    });
  });

  describe('findAllFiles', () => {
    it('finds all non-directory entries', () => {
      const tree = createTestTree();
      const result = findAllFiles(tree);
      expect(result.every((e) => !e.isDirectory)).toBe(true);
      expect(result.length).toBe(5); // index.ts, utils.ts, Button.tsx, README.md, package.json
    });

    it('includes nested files', () => {
      const tree = createTestTree();
      const result = findAllFiles(tree);
      const paths = result.map((e) => e.path);
      expect(paths).toContain('/project/src/components/Button.tsx');
    });

    it('returns empty array for tree with only directories', () => {
      const dirOnly: ProjectFileEntry[] = [
        {
          name: 'folder',
          path: '/folder',
          isDirectory: true,
          children: [
            {
              name: 'subfolder',
              path: '/folder/subfolder',
              isDirectory: true,
              children: [],
            },
          ],
        },
      ];
      const result = findAllFiles(dirOnly);
      expect(result.length).toBe(0);
    });

    it('returns empty array for empty tree', () => {
      const result = findAllFiles([]);
      expect(result).toEqual([]);
    });
  });

  describe('findAllFolders', () => {
    it('finds all directory entries', () => {
      const tree = createTestTree();
      const result = findAllFolders(tree);
      expect(result.every((e) => e.isDirectory)).toBe(true);
      expect(result.length).toBe(2); // src, components
    });

    it('includes nested folders', () => {
      const tree = createTestTree();
      const result = findAllFolders(tree);
      const paths = result.map((e) => e.path);
      expect(paths).toContain('/project/src');
      expect(paths).toContain('/project/src/components');
    });

    it('returns empty array for tree with only files', () => {
      const filesOnly: ProjectFileEntry[] = [
        { name: 'a.txt', path: '/a.txt', isDirectory: false },
        { name: 'b.txt', path: '/b.txt', isDirectory: false },
      ];
      const result = findAllFolders(filesOnly);
      expect(result.length).toBe(0);
    });

    it('returns empty array for empty tree', () => {
      const result = findAllFolders([]);
      expect(result).toEqual([]);
    });
  });
});
