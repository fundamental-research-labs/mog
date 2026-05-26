/**
 * Universal Canvas Object Types
 *
 * App-agnostic base types for floating/canvas objects. These types have ZERO
 * spreadsheet dependencies and serve as the foundation for all app-specific
 * object systems (Spreadsheet, Slides, Docs, Whiteboard, etc.).
 *
 * The key abstraction is the generic `TAnchor` parameter on `CanvasObject`:
 * each app provides its own anchor type (e.g., CellAnchor for spreadsheets,
 * SlideAnchor for slides) and a corresponding `IPositionResolver` to convert
 * anchors to pixel positions at render time.
 *
 * @module @mog-sdk/contracts/objects/canvas-object
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Open string type for canvas object kinds.
 * Well-known constants are provided via CANVAS_OBJECT_TYPES and
 * SPREADSHEET_OBJECT_TYPES, but apps can extend freely with any string.
 */
export type CanvasObjectType = string;

/** Well-known universal object types shared across all apps. */
export const CANVAS_OBJECT_TYPES = {
  PICTURE: 'picture',
  TEXTBOX: 'textbox',
  SHAPE: 'shape',
  CONNECTOR: 'connector',
  DRAWING: 'drawing',
  GROUP: 'group',
} as const;

/** Spreadsheet-specific object types. */
export const SPREADSHEET_OBJECT_TYPES = {
  CHART: 'chart',
  EQUATION: 'equation',
  DIAGRAM: 'diagram',
  OLE_OBJECT: 'oleObject',
  SLICER: 'slicer',
} as const;

// ============================================================================
// Base Object
// ============================================================================

/**
 * Base for all canvas objects across all apps.
 *
 * The `TAnchor` generic parameter is opaque to the core system — each app
 * resolves it to pixel positions at render time via `IPositionResolver`.
 *
 * @template TAnchor App-specific anchor type (CellAnchor, SlideAnchor, etc.)
 */
export interface CanvasObject<TAnchor = unknown> {
  /** Unique identifier */
  id: string;
  /** Object type discriminator */
  type: CanvasObjectType;
  /** Container scope: sheetId, slideId, pageId, etc. */
  containerId: string;
  /** App-specific anchor — opaque to core, resolved at render time */
  anchor: TAnchor;
  /** Z-order (higher = on top) */
  zIndex: number;
  /** Whether object is locked (can't be moved/resized) */
  locked: boolean;
  /** Whether object appears in print output */
  printable: boolean;
  /** Optional name for object */
  name?: string;
  /** Alt text for accessibility */
  altText?: string;
  /** Created timestamp (Unix ms) */
  createdAt?: number;
  /** Last modified timestamp (Unix ms) */
  updatedAt?: number;
}

// ============================================================================
// Position
// ============================================================================

/**
 * Resolved pixel bounds. This is what operations work with after anchor
 * resolution. All values are in pixels relative to the document origin.
 */
export interface CanvasObjectPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

// ============================================================================
// Groups
// ============================================================================

/** Generic group for canvas objects. */
export interface CanvasObjectGroup {
  /** Unique group identifier */
  id: string;
  /** Container scope: sheetId, slideId, pageId, etc. */
  containerId: string;
  /** Object IDs in this group (can include other group IDs) */
  memberIds: string[];
  /** Z-order for the group (all members inherit) */
  zIndex: number;
  /** Group name (optional) */
  name?: string;
  /** Whether the group is locked */
  locked?: boolean;
}

// ============================================================================
// Store Interfaces
// ============================================================================

/** Generic CRUD for canvas objects. Async — Tauri IPC is the primary runtime. */
export interface IObjectStore<T extends CanvasObject = CanvasObject> {
  create(containerId: string, object: T): Promise<{ success: boolean; object?: T }>;
  read(objectId: string): Promise<{ object?: T; containerId?: string }>;
  readInDocument(containerId: string): Promise<T[]>;
  readByType(containerId: string, type: CanvasObjectType): Promise<T[]>;
  update(
    objectId: string,
    updates: Partial<T>,
    containerId?: string,
  ): Promise<{ success: boolean; object?: T }>;
  delete(objectId: string): Promise<{ success: boolean; containerId?: string }>;
  deleteBatch(objectIds: string[]): Promise<number>;
  count(containerId: string): Promise<number>;
}

/** Generic group store. */
export interface IGroupStore<TGroup extends CanvasObjectGroup = CanvasObjectGroup> {
  create(containerId: string, group: TGroup): Promise<boolean>;
  read(groupId: string): Promise<TGroup | undefined>;
  readInDocument(containerId: string): Promise<TGroup[]>;
  delete(groupId: string): Promise<boolean>;
}

// ============================================================================
// Position Resolver
// ============================================================================

/**
 * Resolves app-specific anchors to pixel positions.
 *
 * This is THE key abstraction: each app implements this to convert its native
 * anchor type (cell-based, slide-based, etc.) to the universal
 * `CanvasObjectPosition` that operations and rendering work with.
 *
 * @template TAnchor App-specific anchor type
 */
export interface IPositionResolver<TAnchor = unknown> {
  /** Resolve an anchor to pixel bounds. Returns null if anchor is invalid. */
  resolve(containerId: string, anchor: TAnchor): CanvasObjectPosition | null;
  /** Create an anchor from pixel coordinates. */
  fromPixels(containerId: string, x: number, y: number, width: number, height: number): TAnchor;
}

// ============================================================================
// Event Bus
// ============================================================================

/** Base event type for canvas object events. */
export interface CanvasObjectEvent {
  type: string;
  containerId: string;
  objectId?: string;
  timestamp: number;
  source?: string;
}

/** Generic event bus for canvas object events. */
export interface ICanvasEventBus {
  emit(event: CanvasObjectEvent): void;
  emitBatch(events: CanvasObjectEvent[]): void;
  on(type: string, handler: (event: CanvasObjectEvent) => void): () => void;
}
