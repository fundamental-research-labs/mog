/**
 * WorksheetDiagrams — Sub-API Interface for Diagram Operations
 *
 * CRUD operations plus node manipulation, layout/style changes,
 * and computed layout cache management.
 */
import type { DiagramConfig } from '../types';
import type { DiagramObject } from '@mog/types-objects/objects/floating-objects';
import type {
  ComputedLayout,
  NodeId,
  NodeMoveDirection,
  NodePosition,
  Diagram,
  DiagramNode,
} from '@mog/types-objects/diagrams/types';

// Re-export types that were previously only on the bridge — now canonical in
// @mog/types-objects/diagrams/types so bridges (Tier 2) can consume them
// without routing through api/ (also Tier 2).
export type { NodeMoveDirection, NodePosition };

export interface WorksheetDiagrams {
  // ===========================================================================
  // Core CRUD
  // ===========================================================================

  /** Add a diagram to the sheet. Returns the created floating object. */
  add(config: DiagramConfig): Promise<DiagramObject>;

  /** Get a diagram by object ID, or null if not found. */
  get(objectId: string): Promise<Diagram | null>;

  /** Check if a diagram exists by object ID. */
  has(objectId: string): Promise<boolean>;

  /** Get the total number of diagrams on this sheet. */
  getCount(): Promise<number>;

  /** Remove a diagram by object ID. */
  remove(objectId: string): Promise<void>;

  /** List all diagrams on the sheet. */
  list(): Promise<Diagram[]>;

  /** Remove all diagrams from the sheet. */
  clear(): Promise<void>;

  /** Duplicate a diagram. Returns the new object ID. */
  duplicate(objectId: string): Promise<string>;

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  /** Add a node to a diagram. Returns the new node ID. */
  addNode(
    objectId: string,
    text: string,
    position: NodePosition,
    referenceNodeId: NodeId | null,
  ): Promise<NodeId>;

  /** Remove a node from a diagram. */
  removeNode(objectId: string, nodeId: NodeId): Promise<void>;

  /** Update a node's properties. */
  updateNode(objectId: string, nodeId: NodeId, updates: Partial<DiagramNode>): Promise<void>;

  /** Move a node in the hierarchy. */
  moveNode(objectId: string, nodeId: NodeId, direction: NodeMoveDirection): Promise<void>;

  /** Get a node by ID. */
  getNode(objectId: string, nodeId: NodeId): Promise<DiagramNode | undefined>;

  // ===========================================================================
  // Diagram Reads
  // ===========================================================================

  /**
   * @deprecated Use `get(objectId)` instead. Will be removed in a future release.
   */
  getDiagram(objectId: string): Promise<Diagram | null>;

  /**
   * @deprecated Use `list()` instead. Will be removed in a future release.
   */
  getDiagramsOnSheet(): Promise<Diagram[]>;

  // ===========================================================================
  // Layout and Style
  // ===========================================================================

  /** Change the diagram layout. */
  changeLayout(objectId: string, newLayoutId: string): Promise<void>;

  /** Change the quick style. */
  changeQuickStyle(objectId: string, quickStyleId: string): Promise<void>;

  /** Change the color theme. */
  changeColorTheme(objectId: string, colorThemeId: string): Promise<void>;

  // ===========================================================================
  // Layout Computation (Cache Management)
  // ===========================================================================

  /** Get the computed layout for a diagram. Returns cached result if valid. */
  getComputedLayout(objectId: string): Promise<ComputedLayout | undefined>;

  /** Invalidate the cached layout for a diagram. */
  invalidateLayout(objectId: string): void;

  /** Invalidate all cached layouts. */
  invalidateAllLayouts(): void;
}
