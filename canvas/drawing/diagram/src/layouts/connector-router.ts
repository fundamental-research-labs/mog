/**
 * Connector Router - Calculates paths between nodes in Diagram layouts
 *
 * This module provides different routing strategies for connectors:
 * - Direct: Straight line between connection points
 * - Orthogonal: Elbow/right-angle paths
 * - Bezier: Smooth curved paths with control points
 *
 * All routers are pure functions with O(1) complexity for path calculation.
 */

import type { NodeId } from '@mog-sdk/contracts/diagram';
import type {
  ConnectionPoint,
  ConnectorPath,
  ConnectorRouterOptions,
  IConnectorRouter,
  NodePosition,
} from './types';

// =============================================================================
// Types
// =============================================================================

// All connector-router types (ConnectionPoint, ConnectorPath,
// ConnectorRouterOptions, IConnectorRouter) live in `./types` so that
// `base-layout.ts` can reference `IConnectorRouter` without pulling in this
// module (which would import `NodePosition` back from `base-layout`, forming a
// cycle). Re-exported here for backward-compatible consumer imports.
export type {
  ConnectionPoint,
  ConnectorPath,
  ConnectorRouterOptions,
  IConnectorRouter,
  NodePosition,
} from './types';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the x,y coordinate for a connection point on a node
 * @complexity O(1)
 * @sideEffects None - pure function
 */
function getConnectionCoordinate(
  cp: ConnectionPoint,
  positions: Map<NodeId, NodePosition>,
): { x: number; y: number } | null {
  const node = positions.get(cp.nodeId);
  if (!node) return null;

  const { x, y, width, height } = node;
  const offset = cp.offset ?? { x: 0, y: 0 };

  switch (cp.side) {
    case 'top':
      return { x: x + width / 2 + offset.x, y: y + offset.y };
    case 'bottom':
      return { x: x + width / 2 + offset.x, y: y + height + offset.y };
    case 'left':
      return { x: x + offset.x, y: y + height / 2 + offset.y };
    case 'right':
      return { x: x + width + offset.x, y: y + height / 2 + offset.y };
    case 'center':
      return { x: x + width / 2 + offset.x, y: y + height / 2 + offset.y };
  }
}

// =============================================================================
// Router Implementations
// =============================================================================

/**
 * Direct connector router - draws straight lines between connection points
 */
export class DirectConnectorRouter implements IConnectorRouter {
  /**
   * @complexity O(1) - constant time lookup and calculation
   * @sideEffects None - pure function
   */
  route(
    from: ConnectionPoint,
    to: ConnectionPoint,
    positions: Map<NodeId, NodePosition>,
    _existingConnectors: readonly ConnectorPath[],
    _options?: ConnectorRouterOptions,
  ): ConnectorPath {
    const fromPos = getConnectionCoordinate(from, positions);
    const toPos = getConnectionCoordinate(to, positions);

    // Handle missing nodes gracefully
    if (!fromPos || !toPos) {
      return {
        type: 'line',
        points: [],
      };
    }

    return {
      type: 'line',
      points: [fromPos, toPos],
    };
  }
}

/**
 * Orthogonal connector router - draws elbow/right-angle paths
 */
export class OrthogonalConnectorRouter implements IConnectorRouter {
  /**
   * @complexity O(1) - constant time calculation
   * @sideEffects None - pure function
   */
  route(
    from: ConnectionPoint,
    to: ConnectionPoint,
    positions: Map<NodeId, NodePosition>,
    _existingConnectors: readonly ConnectorPath[],
    options?: ConnectorRouterOptions,
  ): ConnectorPath {
    const fromPos = getConnectionCoordinate(from, positions);
    const toPos = getConnectionCoordinate(to, positions);

    // Handle missing nodes gracefully
    if (!fromPos || !toPos) {
      return {
        type: 'polyline',
        points: [],
      };
    }

    const margin = options?.margin ?? 10;

    // Determine path based on connection sides
    const points: Array<{ x: number; y: number }> = [fromPos];

    // Calculate elbow path based on sides
    if (from.side === 'bottom' && to.side === 'top') {
      // Vertical parent-child connection
      const midY = (fromPos.y + toPos.y) / 2;
      points.push({ x: fromPos.x, y: midY });
      points.push({ x: toPos.x, y: midY });
    } else if (from.side === 'right' && to.side === 'left') {
      // Horizontal left-to-right connection
      const midX = (fromPos.x + toPos.x) / 2;
      points.push({ x: midX, y: fromPos.y });
      points.push({ x: midX, y: toPos.y });
    } else if (from.side === 'left' && to.side === 'right') {
      // Horizontal right-to-left connection
      const midX = (fromPos.x + toPos.x) / 2;
      points.push({ x: midX, y: fromPos.y });
      points.push({ x: midX, y: toPos.y });
    } else if (from.side === 'top' && to.side === 'bottom') {
      // Vertical bottom-to-top connection
      const midY = (fromPos.y + toPos.y) / 2;
      points.push({ x: fromPos.x, y: midY });
      points.push({ x: toPos.x, y: midY });
    } else if (from.side === 'bottom' && to.side === 'left') {
      // Corner: down then right
      points.push({ x: fromPos.x, y: fromPos.y + margin });
      points.push({ x: toPos.x - margin, y: fromPos.y + margin });
      points.push({ x: toPos.x - margin, y: toPos.y });
    } else if (from.side === 'bottom' && to.side === 'right') {
      // Corner: down then left
      points.push({ x: fromPos.x, y: fromPos.y + margin });
      points.push({ x: toPos.x + margin, y: fromPos.y + margin });
      points.push({ x: toPos.x + margin, y: toPos.y });
    } else if (from.side === 'right' && to.side === 'top') {
      // Corner: right then down
      points.push({ x: fromPos.x + margin, y: fromPos.y });
      points.push({ x: fromPos.x + margin, y: toPos.y - margin });
      points.push({ x: toPos.x, y: toPos.y - margin });
    } else if (from.side === 'center' || to.side === 'center') {
      // Direct for center connections
      // No intermediate points needed
    } else {
      // Default: simple L-shape
      if (Math.abs(fromPos.x - toPos.x) > Math.abs(fromPos.y - toPos.y)) {
        // Horizontal primary
        points.push({ x: toPos.x, y: fromPos.y });
      } else {
        // Vertical primary
        points.push({ x: fromPos.x, y: toPos.y });
      }
    }

    points.push(toPos);

    return {
      type: 'polyline',
      points,
    };
  }
}

/**
 * Bezier connector router - draws smooth curved paths
 */
export class BezierConnectorRouter implements IConnectorRouter {
  /**
   * @complexity O(1) - constant time calculation
   * @sideEffects None - pure function
   */
  route(
    from: ConnectionPoint,
    to: ConnectionPoint,
    positions: Map<NodeId, NodePosition>,
    _existingConnectors: readonly ConnectorPath[],
    _options?: ConnectorRouterOptions,
  ): ConnectorPath {
    const fromPos = getConnectionCoordinate(from, positions);
    const toPos = getConnectionCoordinate(to, positions);

    // Handle missing nodes gracefully
    if (!fromPos || !toPos) {
      return {
        type: 'bezier',
        points: [],
        controlPoints: [],
      };
    }

    // Calculate control points based on connection sides
    const controlPoint1 = this.calculateControlPoint(from, fromPos, positions);
    const controlPoint2 = this.calculateControlPoint(to, toPos, positions);

    return {
      type: 'bezier',
      points: [fromPos, toPos],
      controlPoints: [controlPoint1, controlPoint2],
    };
  }

  /**
   * Calculate bezier control point extending from connection point
   * @complexity O(1)
   * @sideEffects None - pure function
   */
  private calculateControlPoint(
    cp: ConnectionPoint,
    pos: { x: number; y: number },
    positions: Map<NodeId, NodePosition>,
  ): { x: number; y: number } {
    const node = positions.get(cp.nodeId);
    if (!node) return pos;

    // Control point extends perpendicular to connection side
    const controlDistance = Math.max(node.width, node.height) / 2;

    switch (cp.side) {
      case 'top':
        return { x: pos.x, y: pos.y - controlDistance };
      case 'bottom':
        return { x: pos.x, y: pos.y + controlDistance };
      case 'left':
        return { x: pos.x - controlDistance, y: pos.y };
      case 'right':
        return { x: pos.x + controlDistance, y: pos.y };
      case 'center':
        return pos;
    }
  }
}

// =============================================================================
// Singleton Instances (for convenience)
// =============================================================================

/** Default direct router instance */
export const directRouter = new DirectConnectorRouter();

/** Default orthogonal router instance */
export const orthogonalRouter = new OrthogonalConnectorRouter();

/** Default bezier router instance */
export const bezierRouter = new BezierConnectorRouter();

/**
 * Get a router by routing style
 */
export function getRouterByStyle(style: 'direct' | 'orthogonal' | 'organic'): IConnectorRouter {
  switch (style) {
    case 'direct':
      return directRouter;
    case 'orthogonal':
      return orthogonalRouter;
    case 'organic':
      return bezierRouter;
  }
}
