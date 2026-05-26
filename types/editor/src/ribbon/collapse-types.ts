/**
 * Ribbon Collapse Types
 *
 * Pure type definitions for ribbon responsive collapse.
 * No runtime dependencies - can be used anywhere.
 *
 * ARCHITECTURE:
 * - Types in contracts/ (this file)
 * - Implementation in engine/src/components/toolbar/collapse/
 * - This follows the same package boundary as the Unified Action System
 *
 */

// =============================================================================
// Collapse Level
// =============================================================================

/**
 * Collapse level from 0 (full) to 4 (mobile).
 *
 * | Level | Width Range | Description |
 * |-------|-------------|-------------|
 * | 0 | ≥1400px | Full: All groups expanded, large buttons with labels |
 * | 1 | 1200-1399px | Compact: Large buttons shrink, some labels hide |
 * | 2 | 1000-1199px | Dense: Most buttons icon-only, some groups collapsed |
 * | 3 | 800-999px | Minimal: Low-priority groups collapsed to dropdowns |
 * | 4 | <800px | Mobile: Most groups collapsed, essential buttons only |
 */
export type CollapseLevel = 0 | 1 | 2 | 3 | 4;

// =============================================================================
// Group Render Mode
// =============================================================================

/**
 * How a group renders at a given collapse level.
 *
 * - `full`: All buttons expanded with labels
 * - `compact`: Buttons shrunk, some labels hidden
 * - `icons`: Icon-only buttons
 * - `dropdown`: Single dropdown button for entire group
 * - `hidden`: Group not shown (very narrow widths)
 */
export type GroupRenderMode = 'full' | 'compact' | 'icons' | 'dropdown' | 'hidden';

// =============================================================================
// Group Collapse Configuration
// =============================================================================

/**
 * Configuration for how a group collapses.
 *
 * This is pure data - no logic, no imports from engine.
 * Groups pass this config as a prop, ToolbarGroup uses it to determine render mode.
 */
export interface GroupCollapseConfig {
  /**
   * Priority 1-5: Lower = more important = collapse later.
   *
   * | Priority | Meaning | Example Groups |
   * |----------|---------|----------------|
   * | 1 | HIGH - collapse last | Clipboard |
   * | 2 | Essential formatting | Font, Alignment |
   * | 3 | Important but not critical | Number, Editing |
   * | 4 | Can be accessed via dropdown | Styles, Cells |
   * | 5 | Rarely used | (reserved for future) |
   */
  priority: 1 | 2 | 3 | 4 | 5;

  /**
   * How this group renders at each collapse level.
   *
   * Must define a mode for ALL levels (0-4).
   * Mode should generally progress from more expanded to more collapsed
   * as level increases, respecting the group's priority.
   */
  levels: Record<CollapseLevel, GroupRenderMode>;
}

// =============================================================================
// Ribbon Collapse State
// =============================================================================

/**
 * State provided by RibbonCollapseContext.
 *
 * This is the SINGLE SOURCE OF TRUTH for collapse state.
 * Computed once in useRibbonCollapse hook, broadcast via context.
 */
export interface RibbonCollapseState {
  /** Current collapse level (0-4) */
  level: CollapseLevel;

  /** Container width in pixels (for debugging/fine-tuning) */
  containerWidth: number;
}
