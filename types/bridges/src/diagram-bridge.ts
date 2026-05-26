/**
 * Diagram Bridge Interface
 *
 * Defines the contract for Diagram diagram management and layout computation.
 * This interface bridges the Diagram system to the engine's reactive system.
 *
 * Features:
 * - Computed layout caching (invalidated on structure/style changes)
 * - Event subscriptions for reactive updates
 * - Node operations (add, remove, update, move)
 * - Layout and style management
 *
 * Architecture Notes:
 * - ComputedLayout is a runtime cache, NOT persisted to storage
 * - The bridge listens to EventBus for automatic cache invalidation
 * - Provides ctx.diagram.* access pattern
 * - Handles serialization/deserialization between TS interfaces and storage
 *
 * Layout Cache Invalidation Strategy:
 * - All node events trigger invalidation: node-added, node-removed, node-updated, node-moved
 * - Layout/style events trigger invalidation: layout-changed, style-changed
 * - Batch events trigger invalidation: nodes-batch-added, nodes-batch-removed
 *
 * @see contracts/src/diagram/types.ts - Core Diagram types
 * @see engine/src/state/bridges/diagram-bridge.ts - Implementation
 */

import type {
  ComputedLayout,
  NodeId,
  Diagram,
  DiagramNode,
} from '@mog/types-objects/diagrams/types';
import type { NodeMoveDirection, NodePosition } from '@mog/types-objects/diagrams/types';

// Re-export so existing bridge consumers don't break
export type { NodeMoveDirection, NodePosition };

// =============================================================================
// Types
// =============================================================================

/**
 * Cache entry for computed Diagram layout.
 *
 * This is a runtime-only cache, NOT persisted to Yjs.
 * Invalidated whenever diagram structure or styling changes.
 */
export interface ComputedLayoutCache {
  /** Diagram object ID this cache entry belongs to */
  objectId: string;

  /** The computed layout result */
  layout: ComputedLayout;

  /** Timestamp when the layout was computed (ms since epoch) */
  lastComputed: number;

  /** Version number, incremented on each invalidation */
  version: number;
}

// =============================================================================
// Diagram Bridge Interface
// =============================================================================

/**
 * Bridge interface for Diagram diagram management.
 *
 * This interface provides methods for managing Diagram diagrams,
 * computing layouts, and handling node operations.
 *
 * LIFECYCLE:
 * 1. Bridge is created during engine initialization
 * 2. start() subscribes to ALL Diagram events on EventBus
 * 3. Event handlers filter by objectId and call invalidateLayout() automatically
 * 4. stop()/destroy() unsubscribes all event listeners during shutdown
 *
 * CACHE MANAGEMENT:
 * - Cache is per-objectId, stored in Map<objectId, ComputedLayoutCache>
 * - getComputedLayout() returns cached result if valid, recomputes otherwise
 * - invalidateLayout() marks a specific diagram for recomputation
 * - invalidateAllLayouts() clears the entire cache (e.g., on style changes)
 */
export interface IDiagramBridge {
  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the Diagram bridge - subscribe to events for reactive updates.
   *
   * Subscribes to the following events for automatic cache invalidation:
   * - diagram:node-added, diagram:node-removed, diagram:node-updated
   * - diagram:node-moved, diagram:nodes-batch-added, diagram:nodes-batch-removed
   * - diagram:layout-changed, diagram:style-changed
   *
   * @returns Cleanup function to stop the bridge
   */
  start(): () => void;

  /**
   * Stop the Diagram bridge and clean up subscriptions.
   */
  stop(): void;

  /**
   * Destroy the bridge - alias for stop().
   */
  destroy(): void;

  // ===========================================================================
  // Diagram Access
  // ===========================================================================

  /**
   * Get a Diagram diagram by object ID.
   * Returns the deserialized TypeScript interface view.
   *
   * @param objectId - Diagram floating object ID
   * @returns The diagram or undefined if not found
   */
  getDiagram(objectId: string): Diagram | undefined | Promise<Diagram | undefined>;

  /**
   * Get all Diagram diagrams on a sheet.
   *
   * @param sheetId - Sheet ID
   * @returns Array of diagrams on the sheet
   */
  getDiagramsOnSheet(sheetId: string): Diagram[] | Promise<Diagram[]>;

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  /**
   * Add a node to a diagram.
   *
   * The new node is positioned relative to the reference node:
   * - 'before': Insert as sibling before reference node
   * - 'after': Insert as sibling after reference node
   * - 'above': Insert as parent of reference node (promote reference)
   * - 'below': Insert as child of reference node
   * - 'child': Same as 'below', insert as last child
   *
   * If referenceNodeId is null, the node is added as a new root.
   *
   * @param objectId - Diagram object ID
   * @param text - Initial text content for the node
   * @param position - Position relative to reference node
   * @param referenceNodeId - Reference node ID (null for root)
   * @returns The ID of the newly created node
   */
  addNode(
    objectId: string,
    text: string,
    position: NodePosition,
    referenceNodeId: NodeId | null,
  ): NodeId | Promise<NodeId>;

  /**
   * Remove a node and optionally its children.
   *
   * By default, children are promoted to the removed node's parent.
   * If the node is a root node with no parent, children become new roots.
   *
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to remove
   */
  removeNode(objectId: string, nodeId: NodeId): void | Promise<void>;

  /**
   * Update node properties.
   *
   * Only provided properties are updated; others remain unchanged.
   * Passing undefined for an optional property removes it.
   *
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to update
   * @param updates - Partial node properties to update
   */
  updateNode(objectId: string, nodeId: NodeId, updates: Partial<DiagramNode>): void | Promise<void>;

  /**
   * Move a node in the hierarchy.
   *
   * Movement directions:
   * - 'promote': Move up one level (become sibling of current parent)
   * - 'demote': Move down one level (become child of previous sibling)
   * - 'move-up': Move earlier in sibling order
   * - 'move-down': Move later in sibling order
   *
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to move
   * @param direction - Direction to move the node
   */
  moveNode(objectId: string, nodeId: NodeId, direction: NodeMoveDirection): void | Promise<void>;

  /**
   * Get a node by ID.
   *
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to retrieve
   * @returns The node or undefined if not found
   */
  getNode(
    objectId: string,
    nodeId: NodeId,
  ): DiagramNode | undefined | Promise<DiagramNode | undefined>;

  // ===========================================================================
  // Layout and Style
  // ===========================================================================

  /**
   * Change the diagram layout.
   *
   * Layout changes may affect node constraints (e.g., max levels, max nodes).
   * The bridge validates the change and adjusts the diagram if needed.
   *
   * @param objectId - Diagram object ID
   * @param newLayoutId - New layout ID (e.g., 'hierarchy/org-chart')
   */
  changeLayout(objectId: string, newLayoutId: string): void | Promise<void>;

  /**
   * Change the quick style.
   *
   * Quick styles control shape fill, stroke, and effects.
   *
   * @param objectId - Diagram object ID
   * @param quickStyleId - Quick style ID (e.g., 'subtle-effect', 'intense-effect')
   */
  changeQuickStyle(objectId: string, quickStyleId: string): void | Promise<void>;

  /**
   * Change the color theme.
   *
   * Color themes control the color palette used for shapes.
   *
   * @param objectId - Diagram object ID
   * @param colorThemeId - Color theme ID (e.g., 'colorful-1', 'accent-1')
   */
  changeColorTheme(objectId: string, colorThemeId: string): void | Promise<void>;

  // ===========================================================================
  // Layout Computation (Cache Management)
  // ===========================================================================

  /**
   * Get the computed layout for a diagram.
   * Returns cached result if valid, otherwise recomputes.
   *
   * This is the PRIMARY method for accessing layout - it manages the cache.
   * Layout computation can be expensive, so caching is important for performance.
   *
   * @param objectId - Diagram object ID
   * @returns Computed layout or undefined if diagram not found
   */
  getComputedLayout(
    objectId: string,
  ): ComputedLayout | undefined | Promise<ComputedLayout | undefined>;

  /**
   * Invalidate the cached layout for a diagram.
   * Called automatically when diagram structure or styling changes.
   *
   * After invalidation, the next call to getComputedLayout() will recompute.
   *
   * @param objectId - Diagram object ID
   */
  invalidateLayout(objectId: string): void;

  /**
   * Invalidate all cached layouts.
   * Called on sheet changes or global style changes.
   *
   * Use sparingly as it forces recomputation of all diagrams.
   */
  invalidateAllLayouts(): void;
}
