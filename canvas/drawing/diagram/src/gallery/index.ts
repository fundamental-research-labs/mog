/**
 * Diagram Layout Gallery
 *
 * Provides a catalog of all available Diagram layouts organized by category.
 * Uses the legacy hardcoded layout registry.
 *
 * @module gallery
 */

import type { DiagramCategory, DiagramLayoutDefinition } from '@mog-sdk/contracts/diagram';

import { layoutRegistry } from '../layouts/registry';

// Re-export preview generator
export {
  clearPreviewCache,
  generateLayoutPreviewSVG,
  getCachedPreviewSVG,
  type PreviewOptions,
} from './preview-generator';

export interface CatalogCategory {
  id: DiagramCategory;
  name: string;
  description: string;
  layouts: DiagramLayoutDefinition[];
}

/**
 * Category order matching Excel's Diagram dialog
 */
const CATEGORY_ORDER: DiagramCategory[] = [
  'list',
  'process',
  'cycle',
  'hierarchy',
  'relationship',
  'matrix',
  'pyramid',
  'picture',
];

/**
 * Display names and descriptions for each category
 */
const CATEGORY_INFO: Record<DiagramCategory, { name: string; description: string }> = {
  list: {
    name: 'List',
    description: 'Show non-sequential or grouped blocks of information',
  },
  process: {
    name: 'Process',
    description: 'Show steps in a process or timeline',
  },
  cycle: {
    name: 'Cycle',
    description: 'Show a continuing sequence of stages, tasks, or events',
  },
  hierarchy: {
    name: 'Hierarchy',
    description: 'Show hierarchical relationships, such as an organization chart',
  },
  relationship: {
    name: 'Relationship',
    description: 'Show connections between two or more sets of information',
  },
  matrix: {
    name: 'Matrix',
    description: 'Show the relationship of components to a whole in quadrants',
  },
  pyramid: {
    name: 'Pyramid',
    description: 'Show proportional, interconnected, or hierarchical relationships',
  },
  picture: {
    name: 'Picture',
    description: 'Show images as integral parts of the diagram',
  },
};

/**
 * Get the full catalog of Diagram layouts organized by category.
 *
 * Returns all categories in Excel's standard order, with their layouts.
 * Uses the legacy layout registry for backward compatibility.
 *
 * @returns Array of catalog categories with their layouts
 */
export function getCatalog(): CatalogCategory[] {
  return CATEGORY_ORDER.map((category) => {
    const info = CATEGORY_INFO[category];
    return {
      id: category,
      name: info.name,
      description: info.description,
      layouts: layoutRegistry.getByCategory(category),
    };
  });
}

/**
 * Search layouts by name or description.
 *
 * Performs case-insensitive substring matching on layout name and description.
 *
 * @param query Search query string
 * @returns Array of matching layout definitions
 */
export function searchLayouts(query: string): DiagramLayoutDefinition[] {
  if (!query || query.trim() === '') {
    return layoutRegistry.getAll();
  }

  const q = query.toLowerCase().trim();
  return layoutRegistry.getAll().filter((layout) => {
    const nameMatch = layout.name.toLowerCase().includes(q);
    const descMatch = layout.description.toLowerCase().includes(q);
    return nameMatch || descMatch;
  });
}
