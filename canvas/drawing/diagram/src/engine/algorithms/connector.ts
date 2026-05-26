/**
 * Connector Algorithm
 *
 * Routes connection lines between source and destination shapes.
 * Supports straight, right-angle bend, cubic Bezier curve, and
 * long-curve routing styles.
 *
 * Parameters:
 * - srcNode: name of the source layout node
 * - dstNode: name of the destination layout node
 * - connRout: routing style (stra, bend, curve, longCurve). Default: stra
 * - begSty: beginning arrowhead style (auto, arr, noArr). Default: auto
 * - endSty: ending arrowhead style (auto, arr, noArr). Default: auto
 * - dim: connector dimension (1D, 2D, cust). Default: 1D
 * - bendPt: bend point position (beg, def, end). Default: def
 * - begPts: beginning connection point. Default: auto
 * - endPts: ending connection point. Default: auto
 *
 * @see ECMA-376 Part 1, Section 21.4.4.8 (Connector Algorithm)
 * @module connector
 */

import type { AlgorithmTypeValue } from '@mog-sdk/contracts/diagram';
import { AlgorithmType } from '@mog-sdk/contracts/diagram';
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';
import {
  calculateConnectionPoint,
  routeBend,
  routeCurve,
  routeStraight,
  type BendPosition,
  type ConnectionPointType,
} from '@mog/geometry/connector-routing';
import type {
  AlgorithmContext,
  AlgorithmResult,
  ILayoutAlgorithm,
  LayoutNodeInstance,
  PositionedConnector,
  PositionedShape,
} from './algorithm-types';
import { getTypedParam } from './param-utils';

// =============================================================================
// Types
// =============================================================================

/** Default curve control point factor (fraction of distance between endpoints). */
const CURVE_CONTROL_FACTOR = 0.33;

/** Long curve control point factor (wider arc). */
const LONG_CURVE_CONTROL_FACTOR = 0.5;

/**
 * Parsed connector parameters.
 */
interface ConnectorParams {
  srcNode: string;
  dstNode: string;
  connRout: 'stra' | 'bend' | 'curve' | 'longCurve';
  begSty: 'auto' | 'arr' | 'noArr';
  endSty: 'auto' | 'arr' | 'noArr';
  dim: '1D' | '2D' | 'cust';
  bendPt: BendPosition;
  begPts: string;
  endPts: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

// Valid value sets for connector parameter validation
const VALID_CONN_ROUT = new Set<ConnectorParams['connRout']>([
  'stra',
  'bend',
  'curve',
  'longCurve',
]);
const VALID_ARROW_STY = new Set<ConnectorParams['begSty']>(['auto', 'arr', 'noArr']);
const VALID_DIM = new Set<ConnectorParams['dim']>(['1D', '2D', 'cust']);
const VALID_BEND_PT = new Set<ConnectorParams['bendPt']>(['beg', 'def', 'end']);

/**
 * Parse connector parameters from the algorithm param map.
 */
function parseConnectorParams(params: Map<string, string>): ConnectorParams {
  return {
    srcNode: params.get('srcNode') ?? '',
    dstNode: params.get('dstNode') ?? '',
    connRout: getTypedParam(params, 'connRout', VALID_CONN_ROUT, 'stra'),
    begSty: getTypedParam(params, 'begSty', VALID_ARROW_STY, 'auto'),
    endSty: getTypedParam(params, 'endSty', VALID_ARROW_STY, 'auto'),
    dim: getTypedParam(params, 'dim', VALID_DIM, '1D'),
    bendPt: getTypedParam(params, 'bendPt', VALID_BEND_PT, 'def'),
    begPts: params.get('begPts') ?? 'auto',
    endPts: params.get('endPts') ?? 'auto',
  };
}

/**
 * Resolve the bounds for a named child node within the children list.
 * Falls back to looking at constraint values.
 */
function resolveNodeBounds(
  nodeName: string,
  children: LayoutNodeInstance[],
  constraints: Map<string, number>,
  bounds: { width: number; height: number },
): BoundingBox | undefined {
  // Look for a child with a matching name
  const child = children.find((c) => c.name === nodeName);

  // Only use node-scoped constraint keys (forName:type pattern).
  // Do NOT fall back to unscoped keys (l, t) as those represent the parent's position.
  const l = constraints.get(`${nodeName}:l`);
  const t = constraints.get(`${nodeName}:t`);
  const w = constraints.get(`${nodeName}:w`);
  const h = constraints.get(`${nodeName}:h`);

  // Check if we have any node-specific constraints
  const hasConstraintKey = l !== undefined || t !== undefined || w !== undefined || h !== undefined;

  if (child || hasConstraintKey) {
    // Use node-specific values where available; for missing position values,
    // default to centered within the container rather than parent's position.
    const resolvedW = w ?? bounds.width;
    const resolvedH = h ?? bounds.height;
    const resolvedL = l ?? (bounds.width - resolvedW) / 2;
    const resolvedT = t ?? (bounds.height - resolvedH) / 2;
    return { x: resolvedL, y: resolvedT, width: resolvedW, height: resolvedH };
  }

  return undefined;
}

// =============================================================================
// Connector Algorithm
// =============================================================================

/**
 * OOXML Connector layout algorithm.
 *
 * Routes connection lines between named source and destination nodes.
 * Supports four routing styles: straight, bend, curve, and long curve.
 *
 * The connector algorithm does not produce positioned shapes (for 1D connectors).
 * For 2D connectors, it additionally produces a shape along the connector path.
 */
export class ConnectorAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.conn;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { children, bounds, constraints, params } = context;
    const connParams = parseConnectorParams(params);

    const shapes: PositionedShape[] = [];
    const connectors: PositionedConnector[] = [];

    // If source or destination node names are not specified, we can't route
    if (!connParams.srcNode || !connParams.dstNode) {
      return { shapes: [], connectors: [], usedBounds: { width: 0, height: 0 } };
    }

    // Resolve source and destination bounds
    const srcBounds = resolveNodeBounds(connParams.srcNode, children, constraints.values, bounds);
    const dstBounds = resolveNodeBounds(connParams.dstNode, children, constraints.values, bounds);

    if (!srcBounds || !dstBounds) {
      // Cannot resolve bounds for one or both nodes
      return { shapes: [], connectors: [], usedBounds: { width: 0, height: 0 } };
    }

    // Calculate source and destination centers for auto/radial point calculation
    const srcCenter: Point2D = {
      x: srcBounds.x + srcBounds.width / 2,
      y: srcBounds.y + srcBounds.height / 2,
    };
    const dstCenter: Point2D = {
      x: dstBounds.x + dstBounds.width / 2,
      y: dstBounds.y + dstBounds.height / 2,
    };

    // Calculate connection endpoints
    const startPt = calculateConnectionPoint(
      srcBounds,
      connParams.begPts as ConnectionPointType,
      dstCenter,
    );
    const endPt = calculateConnectionPoint(
      dstBounds,
      connParams.endPts as ConnectionPointType,
      srcCenter,
    );

    // Route the connector based on the routing style
    let routePoints: Point2D[];
    switch (connParams.connRout) {
      case 'bend':
        routePoints = routeBend(startPt, endPt, connParams.bendPt);
        break;
      case 'curve':
        routePoints = routeCurve(startPt, endPt, CURVE_CONTROL_FACTOR);
        break;
      case 'longCurve':
        routePoints = routeCurve(startPt, endPt, LONG_CURVE_CONTROL_FACTOR);
        break;
      case 'stra':
      default:
        routePoints = routeStraight(startPt, endPt);
        break;
    }

    // Build the connector
    const connector: PositionedConnector = {
      fromId: connParams.srcNode,
      toId: connParams.dstNode,
      routingType: connParams.connRout,
      points: routePoints,
      styleLbl: context.node.styleLbl,
    };
    connectors.push(connector);

    // For 2D connectors, also create a shape along the path
    if (connParams.dim === '2D') {
      const minX = Math.min(...routePoints.map((p) => p.x));
      const minY = Math.min(...routePoints.map((p) => p.y));
      const maxX = Math.max(...routePoints.map((p) => p.x));
      const maxY = Math.max(...routePoints.map((p) => p.y));

      shapes.push({
        modelId: context.node.dataPointId ?? context.node.presOfId,
        shapeType: context.node.shape?.type ?? 'rect',
        x: minX,
        y: minY,
        width: Math.max(maxX - minX, 1),
        height: Math.max(maxY - minY, 1),
        styleLbl: context.node.styleLbl,
        text: context.node.text,
      });
    }

    // Compute used bounds
    const usedWidth =
      routePoints.length > 0
        ? Math.max(...routePoints.map((p) => p.x)) - Math.min(...routePoints.map((p) => p.x))
        : 0;
    const usedHeight =
      routePoints.length > 0
        ? Math.max(...routePoints.map((p) => p.y)) - Math.min(...routePoints.map((p) => p.y))
        : 0;

    return {
      shapes,
      connectors,
      usedBounds: { width: usedWidth, height: usedHeight },
    };
  }
}

/**
 * Create a new ConnectorAlgorithm instance.
 */
export function createConnectorAlgorithm(): ConnectorAlgorithm {
  return new ConnectorAlgorithm();
}
