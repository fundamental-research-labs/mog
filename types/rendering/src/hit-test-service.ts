/**
 * Hit Test Service Interface
 *
 * Service interface for hit testing outline buttons (row/column grouping controls).
 *
 * NOTE: This is a stateless rendering service, NOT a Bridge.
 * Unlike Calculator/Pivot bridges which listen to EventBus triggers and cache
 * computations, HitTestService is synchronous with no lifecycle management needed.
 *
 * @module @mog-sdk/contracts/rendering/hit-test-service
 */

// =============================================================================
// Hit Test Service Interface
// =============================================================================

/**
 * Result of an outline hit test.
 *
 * Returned when testing if a point hits an outline button:
 * - Level buttons (1, 2, 3, ...) for expanding/collapsing to a specific level
 * - Collapse buttons (+/-) for individual groups
 */
export interface OutlineHitTestResult {
  /** Type of button hit */
  type: 'level-button' | 'collapse-button' | 'none';
  /** Whether it's a row or column outline */
  axis: 'row' | 'column';
  /** For level-button: the level clicked (1-8). For collapse-button: undefined */
  level?: number;
  /** For collapse-button: the group ID */
  groupId?: string;
  /** For collapse-button: current collapsed state */
  collapsed?: boolean;
}

/**
 * Service interface for hit testing outline (row/column grouping) buttons.
 *
 * This interface enables decoupling of the state coordinator from canvas
 * implementation details. The coordinator receives an injected service
 * rather than importing the hit test function directly from canvas.
 *
 * Architecture:
 * - State coordinator owns the ObjectCoordination module
 * - ObjectCoordination needs to hit test outline buttons
 * - Canvas provides the implementation via OutlineHitTester class
 * - Coordinator wires the implementation at construction time
 */
export interface HitTestService {
  /**
   * Hit test against outline buttons (row/column grouping controls).
   *
   * Tests if a viewport coordinate hits any outline button:
   * - Level buttons in the corner gutter area
   * - Collapse/expand (+/-) buttons on group summary rows/columns
   *
   * @param x - X coordinate in viewport pixels
   * @param y - Y coordinate in viewport pixels
   * @returns Information about which button was clicked, or result with type='none' if no hit
   */
  hitTestOutline(x: number, y: number): OutlineHitTestResult | null;
}
