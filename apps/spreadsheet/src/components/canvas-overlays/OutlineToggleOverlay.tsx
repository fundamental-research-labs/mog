/**
 * OutlineToggleOverlay Component
 *
 * Renders invisible DOM `<button>` elements positioned over the canvas-drawn
 * outline gutter (row/column grouping). The canvas continues to paint the
 * level buttons (1, 2, 3, ...) and per-group +/- toggles; this overlay adds
 * a parallel DOM input layer so Playwright tests, screen readers, and
 * keyboard navigation can drive the same actions through real DOM events
 * rather than canvas pixel hit-tests.
 *
 * ## Element model
 *
 * For each axis (`row` / `col`):
 *
 * - One `<button data-testid="outline-{axis}-level-{N}">` per level
 * 1..maxLevel+1, positioned at the level button pixel coordinate the
 * renderer draws it at (in the gutter corner).
 * - One `<button data-testid="outline-{axis}-toggle-{index}">` per group,
 * positioned at the +/- toggle pixel coordinate the renderer draws it at.
 * `{index}` is the group's start row/col — a stable identifier across
 * re-renders.
 *
 * ## Behavior parity
 *
 * Click handlers dispatch the *same* actions the canvas hit-tester
 * (`use-grid-mouse.ts`, `coordinator.objects.hitTestOutline()`) currently
 * dispatches: `groupingState.setLevelCollapsed(axis, level, collapsed)` for
 * level buttons and `groupingState.toggleGroupCollapsed(groupId)` for
 * toggles. No business logic is duplicated here — the overlay is a thin
 * input shim.
 *
 * The canvas hit-tester remains active. If both layers fire on a single
 * click, that's a future cleanup (decommission the canvas-side outline
 * hit-test once we're confident the overlay covers every case). For now
 * having both is harmless: setLevelCollapsed/toggleGroupCollapsed are
 * idempotent enough that a duplicate dispatch produces the same end state,
 * and the DOM `<button>` swallows the underlying canvas click via standard
 * event bubbling because pointer-events: auto is set on the button itself.
 *
 * ## Geometry
 *
 * The overlay container is positioned at the top-left of the canvas
 * viewport (NOT after headers — outline elements live to the LEFT of the
 * row header and ABOVE the column header). Pixel positions are derived
 * client-side from the same constants and helpers the renderer uses
 * (`OUTLINE_LEVEL_WIDTH`, `OUTLINE_LEVEL_HEIGHT`, `OUTLINE_BUTTON_SIZE`,
 * `getEffectiveHeaderDimensions`) and from `coords.cellToViewport()` for
 * adjacent summary row/col positions.
 *
 * ## Why a separate overlay container
 *
 * `CanvasInteractiveOverlay` is offset by `headerOffset` (after row/col
 * headers) so its children's coordinate space matches per-cell elements.
 * Outline elements live in the gutter regions BEFORE/ABOVE headers, so
 * sharing that container would require negative coordinates that break
 * the "elements are positioned in cell-viewport space" invariant. A
 * dedicated container starting at (0, 0) of the canvas keeps both
 * pieces simple.
 *
 * @see canvas/grid-renderer/src/features/outline-renderer.ts (canonical geometry)
 * @see apps/spreadsheet/src/hooks/shared/use-grid-mouse.ts (legacy canvas hit-test)
 * @module @mog/spreadsheet/components/canvas-overlays
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { getEffectiveHeaderDimensions } from '@mog/spreadsheet-utils/rendering/constants';
import type { GroupDefinition } from '@mog-sdk/contracts/grouping';
import {
  OUTLINE_BUTTON_SIZE,
  OUTLINE_LEVEL_HEIGHT,
  OUTLINE_LEVEL_WIDTH,
} from '@mog-sdk/contracts/rendering';
import type { ISheetViewGeometry } from '@mog-sdk/sheet-view';

import {
  useCoordinator,
  useRendererActions,
  useRendererStatus,
  useSheetViewOptions,
} from '../../hooks';
import { useGroupingState } from '../../hooks/data/use-grouping-state';
import { useActiveSheetId } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

interface ToggleRect {
  axis: 'row' | 'col';
  /** Stable identifier — start row (axis=row) or start col (axis=col) of the group. */
  index: number;
  /** Group ID — passed to toggleGroupCollapsed. */
  groupId: string;
  x: number;
  y: number;
  size: number;
  collapsed: boolean;
}

interface LevelButtonRect {
  axis: 'row' | 'col';
  level: number;
  x: number;
  y: number;
  size: number;
}

function getSummaryIndex(start: number, end: number, summaryAfter: boolean): number {
  return summaryAfter ? end + 1 : start - 1;
}

// =============================================================================
// Component
// =============================================================================

/**
 * DOM input overlay for the outline gutter (row/column grouping +/- toggles
 * and 1/2/3/... level buttons).
 */
export const OutlineToggleOverlay = memo(function OutlineToggleOverlay() {
  const coordinator = useCoordinator();
  const activeSheetId = useActiveSheetId();
  const groupingState = useGroupingState();
  const { isReady } = useRendererStatus();
  const { getGeometry } = useRendererActions();
  const { viewOptions } = useSheetViewOptions(activeSheetId);

  // Re-compute positions on every scroll frame. Outline toggles are
  // anchored to row/col positions which scroll with the cells; level
  // buttons live in the corner and are scroll-invariant, but recomputing
  // them too is cheap and keeps the code uniform.
  //
  // We don't read scroll position directly — we just need a re-render
  // tick. Using a version counter avoids holding a ScrollState object
  // we don't care about.
  const [scrollTick, setScrollTick] = useState(0);
  useEffect(() => {
    const inputCoord = coordinator.input.inputCoordinator;
    return inputCoord.onScrollChange(() => {
      setScrollTick((v) => v + 1);
    });
  }, [coordinator]);

  const geometry = isReady ? getGeometry() : null;

  const { maxRowLevel, maxColLevel, rowGroups, columnGroups, groupingConfig } = groupingState;

  // Compute all button rects. Re-derived whenever grouping data, viewport,
  // header visibility, or the scroll tick changes.
  const { toggles, levelButtons } = useMemo(() => {
    void scrollTick; // dependency — not read directly
    if (!geometry || !groupingConfig) {
      return { toggles: [] as ToggleRect[], levelButtons: [] as LevelButtonRect[] };
    }
    if (maxRowLevel === 0 && maxColLevel === 0) {
      return { toggles: [] as ToggleRect[], levelButtons: [] as LevelButtonRect[] };
    }

    return computeOutlineRects({
      geometry,
      rowGroups,
      columnGroups,
      maxRowLevel,
      maxColLevel,
      summaryRowsBelow: groupingConfig.summaryRowsBelow,
      summaryColumnsRight: groupingConfig.summaryColumnsRight,
      showOutlineLevelButtons: groupingConfig.showOutlineLevelButtons,
      showRowHeaders: viewOptions.showRowHeaders,
      showColumnHeaders: viewOptions.showColumnHeaders,
    });
  }, [
    geometry,
    rowGroups,
    columnGroups,
    maxRowLevel,
    maxColLevel,
    groupingConfig,
    viewOptions.showRowHeaders,
    viewOptions.showColumnHeaders,
    scrollTick,
  ]);

  // Click handlers — reuse the same actions the canvas hit-tester dispatches.
  const handleLevelClick = useCallback(
    (axis: 'row' | 'col', targetLevel: number) => {
      // Mirror use-grid-mouse.ts:528-537 — collapse all levels above the
      // target, expand levels at and below it.
      const stateAxis: 'row' | 'column' = axis === 'row' ? 'row' : 'column';
      const maxLevel = axis === 'row' ? maxRowLevel : maxColLevel;
      for (let level = 1; level <= maxLevel; level++) {
        groupingState.setLevelCollapsed(stateAxis, level, level > targetLevel);
      }
    },
    [groupingState, maxRowLevel, maxColLevel],
  );

  const handleToggleClick = useCallback(
    (groupId: string) => {
      groupingState.toggleGroupCollapsed(groupId);
    },
    [groupingState],
  );

  if (!isReady || !geometry || !groupingConfig) {
    return null;
  }

  if (toggles.length === 0 && levelButtons.length === 0) {
    return null;
  }

  return (
    <div
      // Container starts at the top-left of the canvas viewport — outline
      // gutters and level buttons live BEFORE the row/col headers, so we
      // do NOT offset by headerOffset like CanvasInteractiveOverlay does.
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 1 }}
      aria-hidden="true"
      data-testid="outline-toggle-overlay"
    >
      {levelButtons.map((btn) => (
        <button
          key={`level-${btn.axis}-${btn.level}`}
          type="button"
          style={{
            position: 'absolute',
            left: btn.x - btn.size / 2,
            top: btn.y - btn.size / 2,
            width: btn.size,
            height: btn.size,
            opacity: 0,
            cursor: 'pointer',
            pointerEvents: 'auto',
            border: 'none',
            background: 'transparent',
            padding: 0,
            margin: 0,
          }}
          aria-label={`Outline ${btn.axis} level ${btn.level}`}
          data-no-grid-pointer="true"
          data-testid={`outline-${btn.axis}-level-${btn.level}`}
          onClick={() => handleLevelClick(btn.axis, btn.level)}
          className="focus:outline focus:outline-2 focus:outline-ss-primary focus:outline-offset-1"
        />
      ))}
      {toggles.map((tgl) => (
        <button
          key={`toggle-${tgl.axis}-${tgl.groupId}`}
          type="button"
          style={{
            position: 'absolute',
            left: tgl.x - tgl.size / 2,
            top: tgl.y - tgl.size / 2,
            width: tgl.size,
            height: tgl.size,
            opacity: 0,
            cursor: 'pointer',
            pointerEvents: 'auto',
            border: 'none',
            background: 'transparent',
            padding: 0,
            margin: 0,
          }}
          aria-label={`Outline ${tgl.axis} group ${tgl.collapsed ? 'expand' : 'collapse'}`}
          aria-expanded={!tgl.collapsed}
          data-no-grid-pointer="true"
          data-testid={`outline-${tgl.axis}-toggle-${tgl.index}`}
          onClick={() => handleToggleClick(tgl.groupId)}
          className="focus:outline focus:outline-2 focus:outline-ss-primary focus:outline-offset-1"
        />
      ))}
    </div>
  );
});

// =============================================================================
// Geometry — mirrors canvas/grid-renderer/src/features/outline-renderer.ts
// =============================================================================

interface ComputeOutlineRectsArgs {
  geometry: ISheetViewGeometry;
  rowGroups: GroupDefinition[];
  columnGroups: GroupDefinition[];
  maxRowLevel: number;
  maxColLevel: number;
  summaryRowsBelow: boolean;
  summaryColumnsRight: boolean;
  showOutlineLevelButtons: boolean;
  showRowHeaders: boolean;
  showColumnHeaders: boolean;
}

/**
 * Compute pixel positions for every outline level button and per-group +/-
 * toggle. Mirrors the geometry in canvas/grid-renderer/src/features/
 * outline-renderer.ts so the DOM overlay aligns exactly with the canvas
 * paint.
 */
function computeOutlineRects(args: ComputeOutlineRectsArgs): {
  toggles: ToggleRect[];
  levelButtons: LevelButtonRect[];
} {
  const {
    geometry,
    rowGroups,
    columnGroups,
    maxRowLevel,
    maxColLevel,
    summaryRowsBelow,
    summaryColumnsRight,
    showOutlineLevelButtons,
    showRowHeaders,
    showColumnHeaders,
  } = args;

  const { rowHeaderWidth, colHeaderHeight } = getEffectiveHeaderDimensions({
    showRowHeaders,
    showColumnHeaders,
  });

  const rowGutterWidth = maxRowLevel > 0 ? maxRowLevel * OUTLINE_LEVEL_WIDTH : 0;
  const colGutterHeight = maxColLevel > 0 ? maxColLevel * OUTLINE_LEVEL_HEIGHT : 0;

  const levelButtons: LevelButtonRect[] = [];
  const toggles: ToggleRect[] = [];

  // ── Level buttons in the corner ─────────────────────────────────────────
  // Mirror outline-renderer.ts renderLevelButtons (and HeadersLayer
  // renderLevelButtons in canvas/grid-renderer/src/layers/headers.ts).
  // Range is 1..maxLevel+1 to match the canvas-draw loop.
  if (showOutlineLevelButtons && maxRowLevel > 0) {
    const y = colGutterHeight > 0 ? colGutterHeight / 2 : colHeaderHeight / 2;
    for (let level = 1; level <= maxRowLevel + 1; level++) {
      const x = (level - 1) * OUTLINE_LEVEL_WIDTH + OUTLINE_LEVEL_WIDTH / 2;
      levelButtons.push({ axis: 'row', level, x, y, size: OUTLINE_BUTTON_SIZE });
    }
  }
  if (showOutlineLevelButtons && maxColLevel > 0) {
    const x = rowGutterWidth > 0 ? rowGutterWidth / 2 : rowHeaderWidth / 2;
    for (let level = 1; level <= maxColLevel + 1; level++) {
      const y = (level - 1) * OUTLINE_LEVEL_HEIGHT + OUTLINE_LEVEL_HEIGHT / 2;
      levelButtons.push({ axis: 'col', level, x, y, size: OUTLINE_BUTTON_SIZE });
    }
  }

  // ── Row collapse buttons ────────────────────────────────────────────────
  // Mirrors hitTestRowCollapseButtons / renderRowOutlineGutter. The button
  // sits at row Y (center) and gutter X = (level-1)*W + W/2. Only groups
  // whose summary row is currently visible get a button.
  for (const group of rowGroups) {
    const buttonRow = getSummaryIndex(group.start, group.end, summaryRowsBelow);
    if (buttonRow < 0) continue;
    const cellRect = geometry.getCellRect({ row: buttonRow, col: 0 });
    if (!cellRect) continue;
    const buttonX = (group.level - 1) * OUTLINE_LEVEL_WIDTH + OUTLINE_LEVEL_WIDTH / 2;
    const buttonY = cellRect.y + cellRect.height / 2;
    toggles.push({
      axis: 'row',
      index: group.start,
      groupId: group.id,
      x: buttonX,
      y: buttonY,
      size: OUTLINE_BUTTON_SIZE,
      collapsed: group.collapsed,
    });
  }

  // ── Column collapse buttons ─────────────────────────────────────────────
  for (const group of columnGroups) {
    const buttonCol = getSummaryIndex(group.start, group.end, summaryColumnsRight);
    if (buttonCol < 0) continue;
    const cellRect = geometry.getCellRect({ row: 0, col: buttonCol });
    if (!cellRect) continue;
    const buttonX = cellRect.x + cellRect.width / 2;
    const buttonY = (group.level - 1) * OUTLINE_LEVEL_HEIGHT + OUTLINE_LEVEL_HEIGHT / 2;
    toggles.push({
      axis: 'col',
      index: group.start,
      groupId: group.id,
      x: buttonX,
      y: buttonY,
      size: OUTLINE_BUTTON_SIZE,
      collapsed: group.collapsed,
    });
  }

  return { toggles, levelButtons };
}
