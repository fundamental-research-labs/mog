/**
 * HomeRibbon
 *
 * Home tab content: Clipboard, Font, Alignment, Number, Styles, Cells, Editing groups.
 *
 * Each group is self-sufficient and uses its own hook for state/actions.
 * No props are passed - all state comes from UIStore (Zustand) and group-specific hooks.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders when TabbedToolbar
 * re-renders due to canUndo/canRedo prop changes. Since HomeRibbon has no props,
 * memo ensures it only re-renders when its internal hooks trigger updates.
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 *
 */

import React from 'react';

import {
  AlignmentGroup,
  CellsGroup,
  ClipboardGroup,
  EditingGroup,
  FontGroup,
  NumberGroup,
  StylesGroup,
} from '../groups';

// =============================================================================
// Component
// =============================================================================

/**
 * Home ribbon - composition of self-sufficient groups.
 *
 * Each group:
 * - Uses its own hook for domain-specific state and actions
 * - Consumes shared state from UIStore (Zustand)
 * - Manages its own local UI state (dropdowns)
 *
 * This eliminates the 100+ props that were previously drilled through.
 * Memoized to prevent cascading re-renders from parent TabbedToolbar.
 */
export const HomeRibbon = React.memo(function HomeRibbon() {
  return (
    <>
      <ClipboardGroup />
      <FontGroup />
      <AlignmentGroup />
      <NumberGroup />
      <StylesGroup />
      <CellsGroup />
      <EditingGroup />
    </>
  );
});
