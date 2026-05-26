/**
 * Layout Registry (DEPRECATED)
 *
 * @deprecated This registry stores hardcoded layout implementations that are
 * being replaced by the new OOXML layout engine.
 *
 * For new code, use:
 * - `layoutDefinitionRegistry` from `src/definitions/index.ts` for layout definitions
 * - `computeLayoutFromDefinition()` from `src/engine/layout-engine.ts` for layout computation
 *
 * This module is retained for backward compatibility.
 *
 * Central registry for all Diagram layout definitions.
 * Provides lookup by ID or category for the layout gallery.
 *
 * NOTE: The `algorithm` field in DiagramLayoutDefinition is a classification
 * string (e.g., 'linear-vertical', 'tree-horizontal'). The actual layout
 * implementation instances are stored separately in implementationRegistry
 * to avoid coupling contracts to implementation.
 */

import type {
  ILayoutAlgorithm,
  ILayoutRegistry,
  DiagramCategory,
  DiagramLayoutDefinition,
} from '@mog-sdk/contracts/diagram';

// Import layout registrations
import { cycleImplementations, registerCycleLayouts } from './cycle';
import { hierarchyImplementations, registerHierarchyLayouts } from './hierarchy';
import { listImplementations, registerListLayouts } from './list';
import { matrixImplementations, registerMatrixLayouts } from './matrix';
import { pictureImplementations, registerPictureLayouts } from './picture';
import { processImplementations, registerProcessLayouts } from './process';
import { pyramidImplementations, registerPyramidLayouts } from './pyramid';
import { registerRelationshipLayouts, relationshipImplementations } from './relationship';

// =============================================================================
// Implementation Registry
// =============================================================================

/**
 * Separate registry for layout algorithm implementations.
 *
 * This keeps the contracts (DiagramLayoutDefinition) clean while
 * allowing us to look up the actual layout algorithm by ID.
 */
export const implementationRegistry = new Map<string, ILayoutAlgorithm>();

// =============================================================================
// Layout Registry Implementation
// =============================================================================

/**
 * Layout registry implementation.
 *
 * Stores all layout definitions and provides lookup methods.
 */
class LayoutRegistryImpl implements ILayoutRegistry {
  layouts = new Map<string, DiagramLayoutDefinition>();

  /**
   * Register a new layout definition.
   *
   * @param layout Layout definition to register
   */
  register(layout: DiagramLayoutDefinition): void {
    this.layouts.set(layout.id, layout);
  }

  /**
   * Get a layout by its ID.
   *
   * @param id Layout ID
   * @returns Layout definition or undefined if not found
   */
  getById(id: string): DiagramLayoutDefinition | undefined {
    return this.layouts.get(id);
  }

  /**
   * Get all layouts in a category.
   *
   * @param category Category to filter by
   * @returns Array of layouts in the category
   */
  getByCategory(category: DiagramCategory): DiagramLayoutDefinition[] {
    return Array.from(this.layouts.values()).filter((l) => l.category === category);
  }

  /**
   * Get all registered layouts.
   *
   * @returns Array of all layout definitions
   */
  getAll(): DiagramLayoutDefinition[] {
    return Array.from(this.layouts.values());
  }

  /**
   * Check if a layout is registered.
   *
   * @param id Layout ID to check
   * @returns True if registered
   */
  has(id: string): boolean {
    return this.layouts.has(id);
  }

  /**
   * Get count of registered layouts.
   *
   * @returns Number of registered layouts
   */
  get size(): number {
    return this.layouts.size;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Global layout registry singleton.
 *
 * All built-in layouts are registered on module load.
 */
export const layoutRegistry = new LayoutRegistryImpl();

// =============================================================================
// Register All Built-in Layouts
// =============================================================================

// Register all layout definitions
registerListLayouts(layoutRegistry);
registerProcessLayouts(layoutRegistry);
registerCycleLayouts(layoutRegistry);
registerHierarchyLayouts(layoutRegistry);
registerRelationshipLayouts(layoutRegistry);
registerMatrixLayouts(layoutRegistry);
registerPyramidLayouts(layoutRegistry);
registerPictureLayouts(layoutRegistry);

// Register all layout implementations
function registerImplementations(implementations: Map<string, ILayoutAlgorithm>): void {
  implementations.forEach((impl, id) => {
    implementationRegistry.set(id, impl);
  });
}

registerImplementations(listImplementations);
registerImplementations(processImplementations);
registerImplementations(cycleImplementations);
registerImplementations(hierarchyImplementations);
registerImplementations(relationshipImplementations);
registerImplementations(matrixImplementations);
registerImplementations(pyramidImplementations);
registerImplementations(pictureImplementations);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the layout algorithm implementation for a layout ID.
 *
 * @param layoutId Layout ID
 * @returns Layout algorithm implementation or undefined
 */
export function getLayoutImplementation(layoutId: string): ILayoutAlgorithm | undefined {
  return implementationRegistry.get(layoutId);
}

/**
 * Compute layout for a diagram using the appropriate algorithm.
 *
 * @param layoutId Layout ID to use
 * @param nodes Node hierarchy data
 * @param rootNodeIds Root node IDs
 * @param bounds Available bounds
 * @param options Layout options
 * @returns Layout result or null if layout not found
 */
export function computeLayout(
  layoutId: string,
  nodes: Map<
    string,
    {
      level: number;
      parentId: string | null;
      childIds: string[];
      siblingOrder: number;
    }
  >,
  rootNodeIds: string[],
  bounds: { width: number; height: number },
  options: Record<string, unknown> = {},
): ReturnType<ILayoutAlgorithm['compute']> | null {
  const implementation = getLayoutImplementation(layoutId);
  if (!implementation) {
    return null;
  }

  // Cast to branded NodeId type (the bridge ensures these are valid)
  return implementation.compute(
    nodes as Parameters<ILayoutAlgorithm['compute']>[0],
    rootNodeIds as Parameters<ILayoutAlgorithm['compute']>[1],
    bounds,
    options,
  );
}
