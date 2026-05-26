/**
 * Connector Re-Routing Coordination
 *
 * When a shape is moved or resized, any connectors bound to that shape via
 * `startConnection` or `endConnection` must be re-routed so their endpoints
 * track the connected shape's new position.
 *
 * This module:
 * 1. Listens for `floatingObject:updated` events on shapes
 * 2. Finds connectors referencing the updated shape from the cache
 * 3. Recalculates connector endpoint positions using the routing algorithms
 * 4. Updates connector bounds/position in the Yrs document via the workbook API
 *
 * Architecture:
 * - Pure coordination logic, no state ownership
 * - Reads from FloatingObjectCache (synchronous, Zustand)
 * - Writes through ConnectorHandle.update() (Worksheet API -> ComputeBridge -> Rust)
 * - Uses @mog/geometry/connector-routing for endpoint calculation
 *
 * @module coordinator/connector-rerouting
 */

import { ConnectorRouting, type ConnectionPointType } from '@mog/geometry';
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { Workbook } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { FloatingObject, ConnectorObject } from '@mog-sdk/contracts/floating-objects';
import type { FloatingObjectUpdatedEvent } from '@mog-sdk/contracts/events';
import type { FloatingObjectCache, FloatingObjectBounds } from '../cache/floating-object-cache';

// =============================================================================
// Types
// =============================================================================

/** Shape types that can be connection targets (non-connector floating objects). */
const CONNECTABLE_TYPES = new Set([
  'shape',
  'textbox',
  'picture',
  'chart',
  'equation',
  'diagram',
  'oleObject',
]);

/** Fields that indicate a positional change requiring connector re-routing. */
const POSITION_FIELDS = new Set([
  'anchorRow',
  'anchorCol',
  'xOffset',
  'yOffset',
  'x',
  'y',
  'width',
  'height',
  'rotation',
]);

// =============================================================================
// Connection Index
// =============================================================================

/**
 * In-memory index: shapeId -> Set of connectorIds that reference it.
 *
 * Built from the FloatingObjectCache and incrementally maintained as
 * objects are created/updated/deleted. This avoids scanning all objects
 * on every shape move.
 */
export class ConnectionIndex {
  /** shapeId -> set of connector objectIds that connect to this shape */
  private readonly shapeToConnectors = new Map<string, Set<string>>();

  /** Rebuild the index from the full cache state. */
  rebuild(objects: Map<string, FloatingObject>): void {
    this.shapeToConnectors.clear();
    for (const obj of objects.values()) {
      if (obj.type === 'connector') {
        this.indexConnector(obj as ConnectorObject);
      }
    }
  }

  /** Add or update a single connector in the index. */
  upsertConnector(connector: ConnectorObject): void {
    // Remove old entries for this connector (in case connections changed)
    this.removeConnector(connector.id);

    // Add new entries
    this.indexConnector(connector);
  }

  /** Remove a connector from the index. */
  removeConnector(connectorId: string): void {
    for (const connectorSet of this.shapeToConnectors.values()) {
      connectorSet.delete(connectorId);
    }
  }

  /** Get all connector IDs that reference a given shape. */
  getConnectorsForShape(shapeId: string): ReadonlySet<string> {
    return this.shapeToConnectors.get(shapeId) ?? EMPTY_SET;
  }

  private indexConnector(connector: ConnectorObject): void {
    const startId = getConnectionShapeId(connector.startConnection);
    const endId = getConnectionShapeId(connector.endConnection);

    if (startId) {
      let set = this.shapeToConnectors.get(startId);
      if (!set) {
        set = new Set();
        this.shapeToConnectors.set(startId, set);
      }
      set.add(connector.id);
    }

    if (endId) {
      let set = this.shapeToConnectors.get(endId);
      if (!set) {
        set = new Set();
        this.shapeToConnectors.set(endId, set);
      }
      set.add(connector.id);
    }
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

// =============================================================================
// Connection Data Accessors
// =============================================================================

/**
 * Extract the shape ID from a connection endpoint.
 *
 * Handles two data shapes:
 * - TS-native: `{ shapeId: string, siteIndex: number }` (from user-created connectors)
 * - Import: `{ shapeId: number, idx: number }` (from OOXML import via Rust)
 *
 * Returns the shapeId as a string, or undefined if not present.
 */
function getConnectionShapeId(
  connection: { shapeId?: string | number; idx?: number; siteIndex?: number } | undefined | null,
): string | undefined {
  if (!connection) return undefined;
  const id = connection.shapeId;
  if (id == null) return undefined;
  return String(id);
}

/**
 * Extract the connection site index from a connection endpoint.
 *
 * Handles both `siteIndex` (TS contracts) and `idx` (Rust import) field names.
 */
function getConnectionSiteIndex(
  connection: { shapeId?: string | number; idx?: number; siteIndex?: number } | undefined | null,
): number {
  if (!connection) return 0;
  return connection.siteIndex ?? connection.idx ?? 0;
}

// =============================================================================
// Re-Routing Logic
// =============================================================================

/**
 * Given a connector and the current bounds of its connected shapes,
 * compute the new connector bounds (position + size).
 *
 * The connector's bounding box is defined by its start and end points.
 * The start/end points are computed from the connected shapes' bounds
 * and the connection site indices.
 */
function computeConnectorBounds(
  connector: ConnectorObject,
  allObjects: Map<string, FloatingObject>,
  allBounds: Map<string, FloatingObjectBounds>,
): { x: number; y: number; width: number; height: number } | null {
  const startConn = connector.startConnection;
  const endConn = connector.endConnection;
  const startShapeId = getConnectionShapeId(startConn);
  const endShapeId = getConnectionShapeId(endConn);

  if (!startShapeId && !endShapeId) {
    // No connections — nothing to re-route
    return null;
  }

  // Resolve start point
  let startPoint: { x: number; y: number } | null = null;
  if (startShapeId) {
    const shapeBounds = getShapeBounds(startShapeId, allObjects, allBounds);
    if (shapeBounds) {
      const endShapeBounds = endShapeId ? getShapeBounds(endShapeId, allObjects, allBounds) : null;
      const targetCenter = endShapeBounds
        ? {
            x: endShapeBounds.x + endShapeBounds.width / 2,
            y: endShapeBounds.y + endShapeBounds.height / 2,
          }
        : undefined;
      startPoint = ConnectorRouting.calculateConnectionPoint(
        shapeBounds,
        siteIndexToPointType(getConnectionSiteIndex(startConn)),
        targetCenter,
      );
    }
  }

  // Resolve end point
  let endPoint: { x: number; y: number } | null = null;
  if (endShapeId) {
    const shapeBounds = getShapeBounds(endShapeId, allObjects, allBounds);
    if (shapeBounds) {
      const startShapeBounds = startShapeId
        ? getShapeBounds(startShapeId, allObjects, allBounds)
        : null;
      const targetCenter = startShapeBounds
        ? {
            x: startShapeBounds.x + startShapeBounds.width / 2,
            y: startShapeBounds.y + startShapeBounds.height / 2,
          }
        : undefined;
      endPoint = ConnectorRouting.calculateConnectionPoint(
        shapeBounds,
        siteIndexToPointType(getConnectionSiteIndex(endConn)),
        targetCenter,
      );
    }
  }

  // If we only have one endpoint, use the connector's existing other endpoint
  if (!startPoint && !endPoint) return null;

  // Use existing connector position for missing endpoints
  const connBounds = allBounds.get(connector.id);
  if (!startPoint) {
    startPoint = connBounds ? { x: connBounds.x, y: connBounds.y } : { x: 0, y: 0 };
  }
  if (!endPoint) {
    endPoint = connBounds
      ? { x: connBounds.x + connBounds.width, y: connBounds.y + connBounds.height }
      : startPoint;
  }

  // Compute bounding box from the two endpoints
  const minX = Math.min(startPoint.x, endPoint.x);
  const minY = Math.min(startPoint.y, endPoint.y);
  const maxX = Math.max(startPoint.x, endPoint.x);
  const maxY = Math.max(startPoint.y, endPoint.y);

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1), // Ensure non-zero
    height: Math.max(maxY - minY, 1),
  };
}

/**
 * Get the pixel bounds for a shape from the cache.
 * Tries pre-computed bounds first, then falls back to object position fields.
 */
function getShapeBounds(
  shapeId: string,
  objects: Map<string, FloatingObject>,
  bounds: Map<string, FloatingObjectBounds>,
): BoundingBox | null {
  // Prefer pre-computed pixel bounds from Rust
  const cached = bounds.get(shapeId);
  if (cached) {
    return { x: cached.x, y: cached.y, width: cached.width, height: cached.height };
  }

  // Fallback: read from object fields
  const obj = objects.get(shapeId);
  if (!obj) return null;

  // Use position.x/y/width/height if available
  const pos = obj.position;
  if (pos?.x != null && pos?.y != null && pos?.width != null && pos?.height != null) {
    return { x: pos.x, y: pos.y, width: pos.width, height: pos.height };
  }

  return null;
}

/**
 * Map OOXML connection site index to a ConnectionPointType.
 *
 * Standard OOXML connection sites for rectangles:
 * 0 = top center, 1 = right center, 2 = bottom center, 3 = left center
 * 4+ = custom sites (fall back to 'auto')
 */
function siteIndexToPointType(siteIndex: number): ConnectionPointType {
  switch (siteIndex) {
    case 0:
      return 'tCtr';
    case 1:
      return 'midR';
    case 2:
      return 'bCtr';
    case 3:
      return 'midL';
    default:
      return 'auto';
  }
}

// =============================================================================
// Wiring
// =============================================================================

/**
 * Wire connector re-routing into the SheetCoordinator's event flow.
 *
 * Call this once during coordinator setup. Returns an unsubscribe function.
 *
 * @param workbook - Workbook API for event subscriptions and object updates
 * @param cache - Zustand cache for synchronous object reads
 * @returns Unsubscribe function to tear down the wiring
 */
export function wireConnectorRerouting(workbook: Workbook, cache: FloatingObjectCache): () => void {
  const index = new ConnectionIndex();

  // Build initial index from cache
  const initialState = cache.getState();
  index.rebuild(initialState.objects);

  // Keep index in sync with cache changes
  const unsubStore = cache.subscribe((state, prevState) => {
    if (state.objects === prevState.objects) return;

    // Find added/changed objects
    for (const [id, obj] of state.objects) {
      if (obj.type === 'connector') {
        const prev = prevState.objects.get(id);
        if (!prev || prev !== obj) {
          index.upsertConnector(obj as ConnectorObject);
        }
      }
    }

    // Find removed objects
    for (const [id, obj] of prevState.objects) {
      if (!state.objects.has(id) && obj.type === 'connector') {
        index.removeConnector(id);
      }
    }
  });

  // Debounce re-routing: collect shape IDs that changed and process in a microtask
  let pendingShapeIds = new Set<string>();
  let flushScheduled = false;

  const scheduleReroute = (shapeId: string) => {
    pendingShapeIds.add(shapeId);
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushReroute);
    }
  };

  const flushReroute = async () => {
    flushScheduled = false;
    const shapeIds = pendingShapeIds;
    pendingShapeIds = new Set();

    // Collect all connector IDs that need re-routing
    const connectorIds = new Set<string>();
    for (const shapeId of shapeIds) {
      for (const cId of index.getConnectorsForShape(shapeId)) {
        connectorIds.add(cId);
      }
    }

    if (connectorIds.size === 0) return;

    const state = cache.getState();

    for (const connectorId of connectorIds) {
      const connector = state.objects.get(connectorId);
      if (!connector || connector.type !== 'connector') continue;

      const newBounds = computeConnectorBounds(
        connector as ConnectorObject,
        state.objects,
        state.bounds,
      );

      if (!newBounds) continue;

      // Update the connector's position via the Worksheet objects API.
      // This flows through ComputeBridge -> Rust -> MutationResult -> events,
      // which updates the cache automatically.
      //
      // We update the raw position fields (x, y, width, height) that the Rust
      // storage expects for absolute-positioned objects. The `update` call
      // performs a shallow merge into the existing JSON.
      try {
        const connSheetId = connector.sheetId;
        const handle = await workbook
          .getSheetById(toSheetId(connSheetId))
          .connectors.get(connectorId);
        if (handle) {
          await handle.update({
            position: {
              ...connector.position,
              anchorType: 'absolute',
              x: newBounds.x,
              y: newBounds.y,
              width: newBounds.width,
              height: newBounds.height,
            },
          });
        }
      } catch {
        // Connector may have been deleted between scheduling and execution
      }
    }
  };

  // Subscribe to floatingObject:updated events
  const unsubUpdated = workbook.on(
    'floatingObject:updated',
    (event: FloatingObjectUpdatedEvent) => {
      const objectId = event.objectId;
      if (!objectId) return;

      // Check if this is a shape-type object (not a connector)
      const obj = cache.getState().objects.get(objectId);
      if (!obj || !CONNECTABLE_TYPES.has(obj.type)) return;

      // Check if the change involves position/size fields
      const changedFields = event.changedFields;
      if (changedFields && changedFields.length > 0) {
        const hasPositionChange = changedFields.some((f: string) => POSITION_FIELDS.has(f));
        if (!hasPositionChange) return;
      }

      // Check if any connectors reference this shape
      const connectors = index.getConnectorsForShape(objectId);
      if (connectors.size === 0) return;

      scheduleReroute(objectId);
    },
  );

  // Return cleanup function
  return () => {
    unsubStore();
    unsubUpdated();
  };
}
