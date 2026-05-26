import type {
  ConnectionTypeValue,
  ST_AxisType as ContractsST_AxisType,
  ST_ElementType as ContractsST_ElementType,
  PointTypeValue,
} from '@mog-sdk/contracts/diagram';

import { matchesElementType } from './element-type-utils';

/**
 * DataModel - OOXML Diagram Data Model with Navigation API
 *
 * Wraps the OOXML data model (points + connections) and provides a rich
 * navigation API used by forEach, choose/if, and presOf during layout
 * computation.
 *
 * The OOXML data model consists of:
 * - Points: nodes in the diagram (doc, node, asst, parTrans, sibTrans, pres)
 * - Connections: relationships between points (parOf, presOf, presParOf)
 *
 * This class pre-computes indices for O(1) point lookup and O(children)
 * navigation. It is immutable after construction.
 *
 * @see ECMA-376 Section 21.4 (DrawingML - Diagrams)
 */

// ============================================================================
// Type Imports from Contracts
// ============================================================================
// Canonical OOXML types are defined in @mog-sdk/contracts.
// We import type aliases (ST_AxisType, ST_ElementType) directly since they
// are identical. We import value types (PointTypeValue, ConnectionTypeValue)
// as the source of truth for point and connection type unions.
//
// The DataModelPoint and DataModelConnection interfaces below are
// navigation-focused subsets of the full contracts types. They use plain
// strings (not branded ModelId) so the DataModel class can be constructed
// from both simple test fixtures and parser output. The full contracts
// types (with branded ModelId, RichText, DmlShapeProperties, etc.) are
// structurally assignable to these interfaces because ModelId extends string.

/**
 * OOXML axis types for data model navigation.
 * Imported from contracts -- all 13 ST_AxisType values.
 * @see ECMA-376 Section 21.4.7.6 ST_AxisType
 */
export type ST_AxisType = ContractsST_AxisType;

/**
 * Element type filter for navigation.
 * Imported from contracts -- all 10 ST_ElementType values.
 * @see ECMA-376 Section 21.4.7.19 ST_ElementType
 */
export type ST_ElementType = ContractsST_ElementType;

/**
 * Point type in the OOXML data model.
 * Imported from contracts (PointTypeValue) -- includes all ST_PtType values:
 * doc, node, norm, nonNorm, asst, nonAsst, parTrans, pres, sibTrans.
 * @see ECMA-376 Section 21.4.7.50 ST_PtType
 */
export type PointType = PointTypeValue;

/**
 * Connection type in the OOXML data model.
 * Imported from contracts (ConnectionTypeValue) -- includes:
 * parOf, presOf, presParOf, unknownRelationship.
 * @see ECMA-376 Section 21.4.7.15 ST_CxnType
 */
export type ConnectionType = ConnectionTypeValue;

/**
 * A single point (node) in the OOXML data model.
 *
 * This is a navigation-focused subset of the full contracts DataModelPoint.
 * It uses plain strings (not branded ModelId) so the DataModel class can
 * work with both simple test fixtures and full OOXML-parsed objects.
 * The full contracts DataModelPoint is structurally assignable to this
 * interface (ModelId extends string, and extra fields are allowed).
 *
 * @see DataModelPoint in @mog-sdk/contracts for the full type
 */
export interface DataModelPoint {
  /** Unique model identifier for this point */
  readonly modelId: string;

  /** The type of point */
  readonly type: PointType;

  /** Text content of this point (plain string for simple usage, or any shape) */
  readonly text?: string;

  /** Optional property set */
  readonly properties?: Record<string, unknown>;

  /** Optional shape properties */
  readonly shapeProperties?: Record<string, unknown>;
}

/**
 * A connection between two points in the OOXML data model.
 *
 * This is a navigation-focused subset of the full contracts DataModelConnection.
 * Uses plain strings (not branded ModelId) for the same reasons as DataModelPoint.
 *
 * @see DataModelConnection in @mog-sdk/contracts for the full type
 */
export interface DataModelConnection {
  /** Unique model identifier for this connection */
  readonly modelId: string;

  /** The type of connection */
  readonly type: ConnectionType;

  /** Source point model ID */
  readonly srcId: string;

  /** Destination point model ID */
  readonly destId: string;

  /** Source ordering (determines child ordering under a parent) */
  readonly srcOrd: number;

  /** Destination ordering */
  readonly destOrd: number;
}

// ============================================================================
// Internal Index Types
// ============================================================================

/**
 * Pre-computed child ordering entry.
 */
interface ChildEntry {
  readonly pointId: string;
  readonly srcOrd: number;
}

// ============================================================================
// DataModel Class
// ============================================================================

/**
 * OOXML Diagram Data Model with rich navigation API.
 *
 * Provides O(1) point lookup and efficient navigation along all 13 OOXML
 * axis types. Used by the layout engine's forEach, choose/if, and presOf
 * systems to traverse the data model during layout computation.
 *
 * Immutable after construction. All navigation methods return new arrays.
 *
 * @example
 * ```typescript
 * const dm = DataModel.fromPoints(points, connections);
 * const root = dm.getRoot();
 * const children = dm.getChildren(root.modelId);
 * const grandchildren = dm.navigateChained(root.modelId, ['ch', 'ch']);
 * ```
 */
export class DataModel {
  // --- Internal indices (pre-computed for O(1) lookups) ---

  /** Map from modelId to DataModelPoint for O(1) lookup */
  private readonly pointIndex: ReadonlyMap<string, DataModelPoint>;

  /** Map from parent modelId to ordered child entries */
  private readonly childrenIndex: ReadonlyMap<string, readonly ChildEntry[]>;

  /** Map from child modelId to parent modelId */
  private readonly parentIndex: ReadonlyMap<string, string>;

  /** The root document point */
  private readonly rootPoint: DataModelPoint;

  /** All points in the model (ordered as provided) */
  private readonly allPoints: readonly DataModelPoint[];

  /** Pre-computed document order (depth-first traversal from root) */
  private readonly documentOrder: readonly string[];

  /** Map from modelId to index in documentOrder for O(1) ordering */
  private readonly documentOrderIndex: ReadonlyMap<string, number>;

  /** Pre-computed depth for each point */
  private readonly depthIndex: ReadonlyMap<string, number>;

  /** Pre-computed maximum depth in the tree */
  private readonly maxDepthValue: number;

  // ============================================================================
  // Construction
  // ============================================================================

  /**
   * Private constructor. Use DataModel.fromPoints() to create instances.
   */
  private constructor(points: DataModelPoint[], connections: DataModelConnection[]) {
    this.allPoints = Object.freeze([...points]);

    // Build point index
    const pointIndex = new Map<string, DataModelPoint>();
    for (const point of points) {
      // First point with a given modelId wins (graceful handling of duplicates)
      if (!pointIndex.has(point.modelId)) {
        pointIndex.set(point.modelId, point);
      }
    }
    this.pointIndex = pointIndex;

    // Find root point (the single 'doc' type point)
    let rootPoint: DataModelPoint | undefined;
    for (const point of points) {
      if (point.type === 'doc') {
        rootPoint = point;
        break;
      }
    }
    if (!rootPoint) {
      throw new Error('DataModel must contain exactly one point of type "doc" (the root)');
    }
    this.rootPoint = rootPoint;

    // Build children index from parOf connections
    const childrenMap = new Map<string, ChildEntry[]>();
    const parentMap = new Map<string, string>();

    for (const conn of connections) {
      if (conn.type === 'parOf') {
        // parOf: srcId is parent, destId is child
        // Only index connections where both endpoints exist
        if (pointIndex.has(conn.srcId) && pointIndex.has(conn.destId)) {
          let children = childrenMap.get(conn.srcId);
          if (!children) {
            children = [];
            childrenMap.set(conn.srcId, children);
          }
          children.push({ pointId: conn.destId, srcOrd: conn.srcOrd });

          // Record parent (first parOf connection wins for each child)
          if (!parentMap.has(conn.destId)) {
            parentMap.set(conn.destId, conn.srcId);
          }
        }
      }
    }

    // Sort children by srcOrd for each parent
    childrenMap.forEach((children) => {
      children.sort((a, b) => a.srcOrd - b.srcOrd);
    });

    this.childrenIndex = childrenMap;
    this.parentIndex = parentMap;

    // Pre-compute document order (depth-first traversal from root)
    const docOrder: string[] = [];
    const docOrderIndex = new Map<string, number>();
    const visited = new Set<string>();

    const buildDocumentOrder = (pointId: string): void => {
      if (visited.has(pointId)) return; // Circular reference protection
      visited.add(pointId);

      docOrderIndex.set(pointId, docOrder.length);
      docOrder.push(pointId);

      const children = childrenMap.get(pointId);
      if (children) {
        for (const child of children) {
          buildDocumentOrder(child.pointId);
        }
      }
    };

    buildDocumentOrder(rootPoint.modelId);

    // Add any orphaned points not reachable from root (at the end)
    for (const point of points) {
      if (!visited.has(point.modelId) && pointIndex.has(point.modelId)) {
        docOrderIndex.set(point.modelId, docOrder.length);
        docOrder.push(point.modelId);
      }
    }

    this.documentOrder = Object.freeze(docOrder);
    this.documentOrderIndex = docOrderIndex;

    // Pre-compute depths
    const depthMap = new Map<string, number>();
    let maxDepth = 0;

    const buildDepths = (pointId: string, depth: number): void => {
      if (depthMap.has(pointId)) return; // Circular reference protection
      depthMap.set(pointId, depth);
      if (depth > maxDepth) {
        maxDepth = depth;
      }

      const children = childrenMap.get(pointId);
      if (children) {
        for (const child of children) {
          buildDepths(child.pointId, depth + 1);
        }
      }
    };

    buildDepths(rootPoint.modelId, 0);

    // Assign depth to orphaned points
    for (const point of points) {
      if (!depthMap.has(point.modelId)) {
        depthMap.set(point.modelId, 0);
      }
    }

    this.depthIndex = depthMap;
    this.maxDepthValue = maxDepth;
  }

  /**
   * Create a DataModel from raw points and connections.
   *
   * @param points - Array of data model points. Must contain exactly one point of type 'doc'.
   * @param connections - Array of connections between points.
   * @returns A new immutable DataModel instance with pre-computed navigation indices.
   * @throws Error if no point of type 'doc' is found.
   */
  static fromPoints(points: DataModelPoint[], connections: DataModelConnection[]): DataModel {
    return new DataModel(points, connections);
  }

  // ============================================================================
  // Point Lookup
  // ============================================================================

  /**
   * Get a point by its model ID.
   *
   * @param modelId - The unique model identifier of the point.
   * @returns The point, or undefined if not found.
   */
  getPoint(modelId: string): DataModelPoint | undefined {
    return this.pointIndex.get(modelId);
  }

  /**
   * Get the document root point (the single point of type 'doc').
   *
   * @returns The root document point.
   */
  getRoot(): DataModelPoint {
    return this.rootPoint;
  }

  /**
   * Get all points in the data model, optionally filtered by point type.
   *
   * @param ptType - Optional point type filter. If omitted, returns all points.
   * @returns Array of matching points in their original order.
   */
  getAllPoints(ptType?: PointType): DataModelPoint[] {
    if (ptType === undefined) {
      return [...this.allPoints];
    }
    return this.allPoints.filter((p) => p.type === ptType);
  }

  // ============================================================================
  // Core Navigation API
  // ============================================================================

  /**
   * Navigate from a point along an axis, optionally filtering by element type.
   *
   * This is the core navigation method used by forEach, presOf, and choose/if
   * during layout computation. All specific navigation methods delegate to this.
   *
   * @param fromPointId - The starting point's model ID.
   * @param axis - The axis type to navigate along (one of 13 OOXML axis types).
   * @param ptType - Optional element type filter. Defaults to 'all'.
   * @returns Array of matching points in the appropriate order for the axis.
   */
  navigate(fromPointId: string, axis: ST_AxisType, ptType?: ST_ElementType): DataModelPoint[] {
    const effectivePtType = ptType ?? 'all';

    let results: DataModelPoint[];

    switch (axis) {
      case 'self':
        results = this.navigateSelf(fromPointId);
        break;
      case 'ch':
        results = this.navigateChildren(fromPointId);
        break;
      case 'des':
        results = this.navigateDescendants(fromPointId);
        break;
      case 'desOrSelf':
        results = this.navigateDesOrSelf(fromPointId);
        break;
      case 'par':
        results = this.navigateParent(fromPointId);
        break;
      case 'ancst':
        results = this.navigateAncestors(fromPointId);
        break;
      case 'ancstOrSelf':
        results = this.navigateAncstOrSelf(fromPointId);
        break;
      case 'followSib':
        results = this.navigateFollowingSiblings(fromPointId);
        break;
      case 'precedSib':
        results = this.navigatePrecedingSiblings(fromPointId);
        break;
      case 'follow':
        results = this.navigateFollow(fromPointId);
        break;
      case 'preced':
        results = this.navigatePreced(fromPointId);
        break;
      case 'root':
        results = [this.rootPoint];
        break;
      case 'none':
        results = [];
        break;
      default: {
        // Exhaustive check
        const _exhaustive: never = axis;
        throw new Error(`Unknown axis type: ${_exhaustive}`);
      }
    }

    return this.filterByElementType(results, effectivePtType);
  }

  // ============================================================================
  // Navigation Shortcuts
  // ============================================================================

  /**
   * Get the direct children of a point, ordered by srcOrd.
   *
   * @param pointId - The parent point's model ID.
   * @param ptType - Optional element type filter.
   * @returns Array of child points in srcOrd order.
   */
  getChildren(pointId: string, ptType?: ST_ElementType): DataModelPoint[] {
    return this.navigate(pointId, 'ch', ptType);
  }

  /**
   * Get the parent of a point.
   *
   * @param pointId - The child point's model ID.
   * @returns The parent point, or undefined if the point is the root or has no parent.
   */
  getParent(pointId: string): DataModelPoint | undefined {
    const parentId = this.parentIndex.get(pointId);
    if (parentId === undefined) return undefined;
    return this.pointIndex.get(parentId);
  }

  /**
   * Get all siblings of a point (same parent, excluding self), ordered by srcOrd.
   *
   * @param pointId - The point's model ID.
   * @param ptType - Optional element type filter.
   * @returns Array of sibling points (excluding self) in srcOrd order.
   */
  getSiblings(pointId: string, ptType?: ST_ElementType): DataModelPoint[] {
    const parentId = this.parentIndex.get(pointId);
    if (parentId === undefined) return [];

    const children = this.navigateChildren(parentId);
    const filtered = children.filter((p) => p.modelId !== pointId);
    return this.filterByElementType(filtered, ptType ?? 'all');
  }

  /**
   * Get siblings that come AFTER this point in srcOrd order.
   *
   * @param pointId - The point's model ID.
   * @param ptType - Optional element type filter.
   * @returns Array of following sibling points in srcOrd order.
   */
  getFollowingSiblings(pointId: string, ptType?: ST_ElementType): DataModelPoint[] {
    return this.navigate(pointId, 'followSib', ptType);
  }

  /**
   * Get siblings that come BEFORE this point in srcOrd order.
   *
   * @param pointId - The point's model ID.
   * @param ptType - Optional element type filter.
   * @returns Array of preceding sibling points in srcOrd order.
   */
  getPrecedingSiblings(pointId: string, ptType?: ST_ElementType): DataModelPoint[] {
    return this.navigate(pointId, 'precedSib', ptType);
  }

  /**
   * Get all descendants of a point (recursive children), depth-first order.
   *
   * @param pointId - The ancestor point's model ID.
   * @param ptType - Optional element type filter.
   * @returns Array of descendant points in depth-first order.
   */
  getDescendants(pointId: string, ptType?: ST_ElementType): DataModelPoint[] {
    return this.navigate(pointId, 'des', ptType);
  }

  /**
   * Get all ancestors of a point (parent, grandparent, etc.), from immediate parent to root.
   *
   * @param pointId - The descendant point's model ID.
   * @returns Array of ancestor points from immediate parent to root.
   */
  getAncestors(pointId: string): DataModelPoint[] {
    return this.navigate(pointId, 'ancst');
  }

  // ============================================================================
  // Hierarchy Queries
  // ============================================================================

  /**
   * Get the depth of a point from the root.
   * Root has depth 0, its children have depth 1, etc.
   *
   * @param pointId - The point's model ID.
   * @returns The depth, or -1 if the point is not found.
   */
  getDepth(pointId: string): number {
    const depth = this.depthIndex.get(pointId);
    return depth !== undefined ? depth : -1;
  }

  /**
   * Get the maximum depth in the entire data model tree.
   *
   * @returns The maximum depth (0 if only root exists).
   */
  getMaxDepth(): number {
    return this.maxDepthValue;
  }

  /**
   * Get the 1-based position of a point among its siblings (ordered by srcOrd).
   *
   * @param pointId - The point's model ID.
   * @returns The 1-based position, or 0 if the point has no parent.
   */
  getPosition(pointId: string): number {
    const parentId = this.parentIndex.get(pointId);
    if (parentId === undefined) return 0;

    const children = this.childrenIndex.get(parentId);
    if (!children) return 0;

    for (let i = 0; i < children.length; i++) {
      if (children[i].pointId === pointId) {
        return i + 1;
      }
    }
    return 0;
  }

  /**
   * Get the reverse 1-based position of a point among its siblings
   * (counting from the end).
   *
   * @param pointId - The point's model ID.
   * @returns The reverse position (1 = last sibling), or 0 if no parent.
   */
  getReversePosition(pointId: string): number {
    const parentId = this.parentIndex.get(pointId);
    if (parentId === undefined) return 0;

    const children = this.childrenIndex.get(parentId);
    if (!children) return 0;

    for (let i = 0; i < children.length; i++) {
      if (children[i].pointId === pointId) {
        return children.length - i;
      }
    }
    return 0;
  }

  /**
   * Count the number of points reachable from a starting point along an axis,
   * optionally filtered by element type.
   *
   * @param fromPointId - The starting point's model ID.
   * @param axis - The axis type to navigate along.
   * @param ptType - Optional element type filter.
   * @returns The count of matching points.
   */
  getCount(fromPointId: string, axis: ST_AxisType, ptType?: ST_ElementType): number {
    return this.navigate(fromPointId, axis, ptType).length;
  }

  // ============================================================================
  // Chained Axis Navigation
  // ============================================================================

  /**
   * Navigate along multiple chained axes sequentially.
   *
   * For example, axes = ['ch', 'ch'] navigates to grandchildren:
   * first get children, then for each child get their children.
   *
   * @param fromPointId - The starting point's model ID.
   * @param axes - Array of axis types to chain (applied left to right).
   * @param ptTypes - Optional array of element type filters (one per axis, or shorter to leave later axes unfiltered).
   * @returns Array of points reached by chaining all axes. Duplicates are preserved.
   */
  navigateChained(
    fromPointId: string,
    axes: ST_AxisType[],
    ptTypes?: (ST_ElementType | undefined)[],
  ): DataModelPoint[] {
    if (axes.length === 0) return [];

    // Start with the initial point
    let currentPoints: DataModelPoint[] = [];
    const startPoint = this.pointIndex.get(fromPointId);
    if (!startPoint) return [];
    currentPoints = [startPoint];

    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
      const ptType = ptTypes && i < ptTypes.length ? ptTypes[i] : undefined;

      const nextPoints: DataModelPoint[] = [];
      for (const point of currentPoints) {
        const navigated = this.navigate(point.modelId, axis, ptType);
        for (const p of navigated) nextPoints.push(p);
      }
      currentPoints = nextPoints;
    }

    return currentPoints;
  }

  // ============================================================================
  // Internal Navigation Methods
  // ============================================================================

  /**
   * Navigate 'self' axis: returns the point itself.
   */
  private navigateSelf(pointId: string): DataModelPoint[] {
    const point = this.pointIndex.get(pointId);
    return point ? [point] : [];
  }

  /**
   * Navigate 'ch' axis: direct children ordered by srcOrd.
   */
  private navigateChildren(pointId: string): DataModelPoint[] {
    const children = this.childrenIndex.get(pointId);
    if (!children) return [];

    const result: DataModelPoint[] = [];
    for (const child of children) {
      const point = this.pointIndex.get(child.pointId);
      if (point) {
        result.push(point);
      }
    }
    return result;
  }

  /**
   * Navigate 'des' axis: all descendants in depth-first order.
   */
  private navigateDescendants(pointId: string): DataModelPoint[] {
    const result: DataModelPoint[] = [];
    const visited = new Set<string>();

    const collectDescendants = (pid: string): void => {
      const children = this.childrenIndex.get(pid);
      if (!children) return;

      for (const child of children) {
        if (visited.has(child.pointId)) continue; // Circular protection
        visited.add(child.pointId);

        const point = this.pointIndex.get(child.pointId);
        if (point) {
          result.push(point);
          collectDescendants(child.pointId);
        }
      }
    };

    collectDescendants(pointId);
    return result;
  }

  /**
   * Navigate 'desOrSelf' axis: self + all descendants.
   */
  private navigateDesOrSelf(pointId: string): DataModelPoint[] {
    const self = this.pointIndex.get(pointId);
    if (!self) return [];
    return [self, ...this.navigateDescendants(pointId)];
  }

  /**
   * Navigate 'par' axis: parent of the point.
   */
  private navigateParent(pointId: string): DataModelPoint[] {
    const parentId = this.parentIndex.get(pointId);
    if (parentId === undefined) return [];
    const parent = this.pointIndex.get(parentId);
    return parent ? [parent] : [];
  }

  /**
   * Navigate 'ancst' axis: all ancestors from immediate parent to root.
   */
  private navigateAncestors(pointId: string): DataModelPoint[] {
    const result: DataModelPoint[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = pointId;

    while (currentId !== undefined) {
      const parentId = this.parentIndex.get(currentId);
      if (parentId === undefined) break;
      if (visited.has(parentId)) break; // Circular protection
      visited.add(parentId);

      const parent = this.pointIndex.get(parentId);
      if (parent) {
        result.push(parent);
      }
      currentId = parentId;
    }

    return result;
  }

  /**
   * Navigate 'ancstOrSelf' axis: self + all ancestors.
   */
  private navigateAncstOrSelf(pointId: string): DataModelPoint[] {
    const self = this.pointIndex.get(pointId);
    if (!self) return [];
    return [self, ...this.navigateAncestors(pointId)];
  }

  /**
   * Navigate 'followSib' axis: siblings after this point in srcOrd order.
   */
  private navigateFollowingSiblings(pointId: string): DataModelPoint[] {
    const parentId = this.parentIndex.get(pointId);
    if (parentId === undefined) return [];

    const children = this.childrenIndex.get(parentId);
    if (!children) return [];

    let found = false;
    const result: DataModelPoint[] = [];
    for (const child of children) {
      if (found) {
        const point = this.pointIndex.get(child.pointId);
        if (point) {
          result.push(point);
        }
      }
      if (child.pointId === pointId) {
        found = true;
      }
    }
    return result;
  }

  /**
   * Navigate 'precedSib' axis: siblings before this point in srcOrd order.
   */
  private navigatePrecedingSiblings(pointId: string): DataModelPoint[] {
    const parentId = this.parentIndex.get(pointId);
    if (parentId === undefined) return [];

    const children = this.childrenIndex.get(parentId);
    if (!children) return [];

    const result: DataModelPoint[] = [];
    for (const child of children) {
      if (child.pointId === pointId) {
        break;
      }
      const point = this.pointIndex.get(child.pointId);
      if (point) {
        result.push(point);
      }
    }
    return result;
  }

  /**
   * Navigate 'follow' axis: all nodes after this one in document order.
   * Document order is a depth-first traversal from the root.
   */
  private navigateFollow(pointId: string): DataModelPoint[] {
    const orderIdx = this.documentOrderIndex.get(pointId);
    if (orderIdx === undefined) return [];

    const result: DataModelPoint[] = [];
    for (let i = orderIdx + 1; i < this.documentOrder.length; i++) {
      const point = this.pointIndex.get(this.documentOrder[i]);
      if (point) {
        result.push(point);
      }
    }
    return result;
  }

  /**
   * Navigate 'preced' axis: all nodes before this one in document order.
   * Document order is a depth-first traversal from the root.
   */
  private navigatePreced(pointId: string): DataModelPoint[] {
    const orderIdx = this.documentOrderIndex.get(pointId);
    if (orderIdx === undefined) return [];

    const result: DataModelPoint[] = [];
    for (let i = 0; i < orderIdx; i++) {
      const point = this.pointIndex.get(this.documentOrder[i]);
      if (point) {
        result.push(point);
      }
    }
    return result;
  }

  // ============================================================================
  // Element Type Filtering
  // ============================================================================

  /**
   * Filter points by OOXML element type.
   *
   * @param points - Points to filter.
   * @param elementType - The element type filter to apply.
   * @returns Filtered array of points.
   */
  private filterByElementType(
    points: DataModelPoint[],
    elementType: ST_ElementType,
  ): DataModelPoint[] {
    if (elementType === 'all') return points;

    return points.filter((p) => this.matchesElementTypeFilter(p, elementType));
  }

  /**
   * Check if a point matches an element type filter.
   * Delegates to the shared matchesElementType utility.
   *
   * @param point - The point to check.
   * @param elementType - The element type to match against.
   * @returns True if the point matches the filter.
   */
  private matchesElementTypeFilter(point: DataModelPoint, elementType: ST_ElementType): boolean {
    return matchesElementType(point, elementType);
  }
}
