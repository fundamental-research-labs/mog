/**
 * Shared Layout Types (DEPRECATED module surface)
 *
 * Pure type module for the hardcoded layout implementations in this directory.
 * Lives here to break the cycle between `base-layout.ts` and `connector-router.ts`:
 * - `base-layout.ts` needs the `IConnectorRouter` type in its abstract `compute`
 *   signature.
 * - `connector-router.ts` needs the `NodePosition` type in its router interface
 *   and implementations.
 *
 * Both files now import their shared types from here instead of each other.
 *
 * @deprecated Along with the rest of the `layouts/` hardcoded pipeline, these
 * types are being replaced by the OOXML layout engine in `src/engine/`.
 */

import type { NodeId } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Node Layout Types
// =============================================================================

/**
 * Node hierarchy information used by layout algorithms
 */
export interface NodeHierarchyInfo {
  level: number;
  parentId: NodeId | null;
  childIds: NodeId[];
  siblingOrder: number;
}

/**
 * Position result for a single node
 */
export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

// =============================================================================
// Connector Routing Types
// =============================================================================

/**
 * Connection point on a node
 */
export interface ConnectionPoint {
  /** Node ID to connect to */
  nodeId: NodeId;
  /** Side of the node to connect to */
  side: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Optional offset from the side center */
  offset?: { x: number; y: number };
}

/**
 * Computed connector path
 */
export interface ConnectorPath {
  /** Path type for rendering */
  type: 'line' | 'bezier' | 'polyline';
  /** Points along the path */
  points: Array<{ x: number; y: number }>;
  /** Control points for bezier curves */
  controlPoints?: Array<{ x: number; y: number }>;
}

/**
 * Options for connector routing
 */
export interface ConnectorRouterOptions {
  /** Try to avoid crossing other connectors/nodes */
  avoidOverlap?: boolean;
  /** Minimum distance from nodes */
  margin?: number;
  /** Routing style preference */
  routingStyle?: 'direct' | 'orthogonal' | 'organic';
}

/**
 * Connector router interface
 */
export interface IConnectorRouter {
  /**
   * Calculate path between two connection points
   * @complexity O(1) - constant time calculation
   * @sideEffects None - pure function
   */
  route(
    from: ConnectionPoint,
    to: ConnectionPoint,
    nodePositions: Map<NodeId, NodePosition>,
    existingConnectors: readonly ConnectorPath[],
    options?: ConnectorRouterOptions,
  ): ConnectorPath;
}
