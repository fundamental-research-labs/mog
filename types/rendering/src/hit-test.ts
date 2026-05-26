/**
 * Hit Test and Physics Types for Canvas Rendering
 *
 * These types define hit testing results and scroll/zoom physics state.
 * Moved to contracts to enable decoupling of canvas and state subsystems.
 *
 * @module @mog-sdk/contracts/rendering/hit-test
 */

// =============================================================================
// Hit Test Results
// =============================================================================

/** Cell hit result */
export interface CellHitResult {
  type: 'cell';
  row: number;
  col: number;
}

/** Column header hit result */
export interface ColumnHeaderHitResult {
  type: 'columnHeader';
  col: number;
}

/** Row header hit result */
export interface RowHeaderHitResult {
  type: 'rowHeader';
  row: number;
}

/** Column resize handle hit result */
export interface ColumnResizeHitResult {
  type: 'columnResize';
  col: number;
}

/** Row resize handle hit result */
export interface RowResizeHitResult {
  type: 'rowResize';
  row: number;
}

/** Fill handle hit result */
export interface FillHandleHitResult {
  type: 'fillHandle';
}

/** Frozen pane intersection hit result */
export interface FrozenHitResult {
  type: 'frozen';
  region: 'topLeft' | 'top' | 'left';
}

/** Select all button hit result (corner cell) */
export interface SelectAllHitResult {
  type: 'selectAll';
}

/** Empty space hit result */
export interface EmptyHitResult {
  type: 'empty';
}

/** Outline level button hit result */
export interface OutlineLevelButtonHitResult {
  type: 'outlineLevelButton';
  axis: 'row' | 'column';
  level: number;
}

/** Outline collapse button hit result */
export interface OutlineCollapseButtonHitResult {
  type: 'outlineCollapseButton';
  axis: 'row' | 'column';
  groupId: string;
  collapsed: boolean;
}

/** Outline gutter area hit result */
export interface OutlineGutterHitResult {
  type: 'outlineGutter';
  orientation: 'row' | 'column';
}

/** Hidden column boundary hit result */
export interface HiddenColumnBoundaryHitResult {
  type: 'hiddenColumnBoundary';
  col: number;
  hiddenStart: number;
  hiddenEnd: number;
}

/** Hidden row boundary hit result */
export interface HiddenRowBoundaryHitResult {
  type: 'hiddenRowBoundary';
  row: number;
  hiddenStart: number;
  hiddenEnd: number;
}

/** Comment indicator hit result */
export interface CommentIndicatorHitResult {
  type: 'commentIndicator';
  row: number;
  col: number;
}

/** Hit region types for floating objects */
export type ObjectHitRegion =
  | 'body'
  | 'border'
  | 'rotation'
  | 'resize-nw'
  | 'resize-n'
  | 'resize-ne'
  | 'resize-e'
  | 'resize-se'
  | 'resize-s'
  | 'resize-sw'
  | 'resize-w'
  // TextEffect-specific regions
  | 'warp-adjust'; // Yellow diamond handle for adjusting warp intensity

/** Floating object hit result */
export interface FloatingObjectHitResult {
  type: 'floatingObject';
  objectId: string;
  region: ObjectHitRegion;
  isGroup: boolean;
}

/**
 * Result of hit testing a point against the spreadsheet grid.
 * Used to determine what UI element is at a given viewport coordinate.
 */
export type HitTestResult =
  | CellHitResult
  | ColumnHeaderHitResult
  | RowHeaderHitResult
  | ColumnResizeHitResult
  | RowResizeHitResult
  | FillHandleHitResult
  | FrozenHitResult
  | SelectAllHitResult
  | EmptyHitResult
  | OutlineLevelButtonHitResult
  | OutlineCollapseButtonHitResult
  | OutlineGutterHitResult
  | HiddenColumnBoundaryHitResult
  | HiddenRowBoundaryHitResult
  | CommentIndicatorHitResult
  | FloatingObjectHitResult;

/**
 * Unified hit test result - either a cell, header, or floating object.
 * This is the primary type that should be used for hit testing.
 */
export type UnifiedHitResult = HitTestResult;

// =============================================================================
// Scroll State and Physics
// =============================================================================

/**
 * Current scroll state including animation properties.
 */
export interface ScrollState {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  isAnimating: boolean;
}

/**
 * Configuration for scroll physics (momentum, deceleration).
 */
export interface ScrollPhysicsConfig {
  /** Time constant in ms (325 = iOS-like deceleration) */
  decelerationRate: number;
  /** Stop threshold in px/s */
  minVelocity: number;
  /** Clamp maximum velocity in px/s */
  maxVelocity: number;
}

// =============================================================================
// Zoom State and Physics
// =============================================================================

/**
 * Current zoom state including animation properties.
 */
export interface ZoomState {
  level: number;
  centerX: number;
  centerY: number;
  isAnimating: boolean;
}

/**
 * Configuration for zoom physics.
 */
export interface ZoomPhysicsConfig {
  /** Minimum zoom level (e.g., 0.1) */
  minZoom: number;
  /** Maximum zoom level (e.g., 4.0) */
  maxZoom: number;
  /** Duration for animated zoom in ms */
  animationDuration: number;
}

// =============================================================================
// Remote Cursor (Collaboration)
// =============================================================================

import type { CellRange } from '@mog/types-core';
import type { CellCoord } from '@mog/types-viewport/rendering/primitives';

/**
 * Remote user's cursor/selection state (from Yjs awareness).
 * Used for rendering other users' selections in collaborative editing.
 */
export interface RemoteCursor {
  clientId: number;
  user: {
    id: string;
    name: string;
    color: string;
    avatar?: string;
  };
  selection: CellRange[];
  activeCell: CellCoord;
  sheetId: string;
  isEditing: boolean;
  editingCell?: CellCoord;
}

// =============================================================================
// Object Bounds (Floating Objects)
// =============================================================================

/**
 * Object bounds in pixel coordinates.
 * Used for rendering floating objects on the overlay layer.
 *
 * Canonical home promoted to @mog/types-viewport/rendering/bounds during
 * so both machines (Tier 2) and rendering (Tier 2) can consume it
 * without forming a cycle. Re-exported here for back-compat.
 */
import type { ObjectBounds } from '@mog/types-viewport/rendering/bounds';
export type { ObjectBounds };

// =============================================================================
// Effective Object State (Unified Floating Object Operations)
// =============================================================================

/**
 * Effective visual state for a floating object during operations.
 *
 * During drag/resize/rotate operations, this represents the visual position
 * (calculated from original position + delta), not the persisted position.
 * The renderer should use this for display instead of reading persisted state.
 *
 * Three-layer model:
 * - Layer 3 (Local): Current user's in-progress operation (0ms latency)
 * - Layer 2 (Remote): Other users' operations via presence (~100ms latency)
 * - Layer 1 (Base): Persisted state in Yjs (source of truth)
 *
 */
export interface EffectiveObjectState {
  /** Whether this state differs from persisted state */
  isEffective: boolean;
  /** Source of the effective state */
  source: 'local' | 'remote' | 'persisted';
  /** The effective bounds (visual position during operations) */
  bounds: ObjectBounds;
  /** The effective rotation in degrees */
  rotation: number;
}

// =============================================================================
// Preview Cell Data (Paste Preview)
// =============================================================================

import type { CellFormat } from '@mog/types-core';

/**
 * Preview data for a single cell.
 * Contains the value and format that would be applied by a paste operation.
 * Used for rendering paste preview overlays.
 */
export interface PreviewCellData {
  /** Row position (absolute, not relative) */
  row: number;
  /** Column position (absolute, not relative) */
  col: number;
  /** The value that would be pasted (formatted for display) */
  displayValue: string;
  /** The format that would be applied */
  format?: Partial<CellFormat>;
  /** Whether this cell would have a formula */
  hasFormula?: boolean;
}
