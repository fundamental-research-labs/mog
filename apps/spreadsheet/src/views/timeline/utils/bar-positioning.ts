/**
 * Bar Positioning Utilities for Timeline View
 *
 * Calculates bar positions, sizes, and hit testing for timeline bars.
 */

import type { RowId } from '@mog-sdk/contracts/cell-identity';
import type { TimelineScale } from '../config';
import { dateToPixels, parseDate } from './date-utils';

/**
 * A positioned bar on the timeline.
 */
export interface TimelineBar {
  /** Row ID of the record this bar represents */
  rowId: RowId;
  /** X position in pixels from timeline start */
  x: number;
  /** Width in pixels (0 for milestones) */
  width: number;
  /** Y position in pixels from top of timeline content area */
  y: number;
  /** Height in pixels */
  height: number;
  /** Start date */
  startDate: Date;
  /** End date (same as start for milestones) */
  endDate: Date;
  /** Display title */
  title: string;
  /** Bar color (CSS color string) */
  color: string;
  /** Group key (if grouped) */
  groupKey?: string;
  /** Whether this is a milestone (single day) */
  isMilestone: boolean;
  /** Dependencies (row IDs this bar depends on) */
  dependencies?: RowId[];
}

/**
 * A group header in the timeline.
 */
export interface TimelineGroup {
  /** Group key (value from groupByColumn) */
  key: string;
  /** Display label */
  label: string;
  /** Y position of group header */
  y: number;
  /** Height of group including all bars */
  height: number;
  /** Number of bars in this group */
  barCount: number;
  /** Whether the group is collapsed */
  collapsed: boolean;
}

/**
 * Result of calculating all bar positions.
 */
export interface BarLayout {
  bars: TimelineBar[];
  groups: TimelineGroup[];
  totalHeight: number;
  minDate: Date;
  maxDate: Date;
}

/**
 * Input record for bar calculation.
 */
export interface TimelineRecord {
  rowId: RowId;
  startDate: unknown;
  endDate?: unknown;
  title: string;
  color?: string;
  groupKey?: string;
  dependencies?: RowId[];
}

/**
 * Options for calculating bar layout.
 */
export interface BarLayoutOptions {
  timelineStart: Date;
  scale: TimelineScale;
  rowHeight: number;
  barPadding?: number;
  groupHeaderHeight?: number;
  collapsedGroups?: Set<string>;
}

/**
 * Default bar color when no color is specified.
 */
const DEFAULT_BAR_COLOR = '#4A90D9';

/**
 * Minimum bar width in pixels (for visibility).
 */
const MIN_BAR_WIDTH = 4;

/**
 * Calculate bar positions from records.
 */
export function calculateBarLayout(
  records: TimelineRecord[],
  options: BarLayoutOptions,
): BarLayout {
  const {
    timelineStart,
    scale,
    rowHeight,
    barPadding = 4,
    groupHeaderHeight = 32,
    collapsedGroups = new Set(),
  } = options;

  const bars: TimelineBar[] = [];
  const groupMap = new Map<string, TimelineRecord[]>();
  const ungroupedRecords: TimelineRecord[] = [];

  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  // Group records
  for (const record of records) {
    const startDate = parseDate(record.startDate);
    if (!startDate) continue;

    const endDate = parseDate(record.endDate) || startDate;

    // Track date range
    if (!minDate || startDate < minDate) minDate = startDate;
    if (!maxDate || endDate > maxDate) maxDate = endDate;

    if (record.groupKey !== undefined && record.groupKey !== '') {
      const group = groupMap.get(record.groupKey) || [];
      group.push(record);
      groupMap.set(record.groupKey, group);
    } else {
      ungroupedRecords.push(record);
    }
  }

  // Calculate positions
  let currentY = 0;
  const groups: TimelineGroup[] = [];

  // Process grouped records first
  for (const [groupKey, groupRecords] of groupMap) {
    const collapsed = collapsedGroups.has(groupKey);

    groups.push({
      key: groupKey,
      label: groupKey,
      y: currentY,
      height: collapsed ? groupHeaderHeight : groupHeaderHeight + groupRecords.length * rowHeight,
      barCount: groupRecords.length,
      collapsed,
    });

    currentY += groupHeaderHeight;

    if (!collapsed) {
      for (const record of groupRecords) {
        const bar = createBar(record, currentY, rowHeight, barPadding, timelineStart, scale);
        if (bar) {
          bars.push(bar);
          currentY += rowHeight;
        }
      }
    }
  }

  // Process ungrouped records
  for (const record of ungroupedRecords) {
    const bar = createBar(record, currentY, rowHeight, barPadding, timelineStart, scale);
    if (bar) {
      bars.push(bar);
      currentY += rowHeight;
    }
  }

  return {
    bars,
    groups,
    totalHeight: currentY,
    minDate: minDate || new Date(),
    maxDate: maxDate || new Date(),
  };
}

/**
 * Create a bar from a record.
 */
function createBar(
  record: TimelineRecord,
  y: number,
  rowHeight: number,
  barPadding: number,
  timelineStart: Date,
  scale: TimelineScale,
): TimelineBar | null {
  const startDate = parseDate(record.startDate);
  if (!startDate) return null;

  const endDate = parseDate(record.endDate) || startDate;
  const isMilestone = startDate.getTime() === endDate.getTime();

  const x = dateToPixels(startDate, timelineStart, scale);
  let width = isMilestone ? 0 : dateToPixels(endDate, timelineStart, scale) - x;

  // Ensure minimum visibility
  if (!isMilestone && width < MIN_BAR_WIDTH) {
    width = MIN_BAR_WIDTH;
  }

  return {
    rowId: record.rowId,
    x,
    width,
    y: y + barPadding,
    height: rowHeight - barPadding * 2,
    startDate,
    endDate,
    title: record.title,
    color: record.color || DEFAULT_BAR_COLOR,
    groupKey: record.groupKey,
    isMilestone,
    dependencies: record.dependencies,
  };
}

/**
 * Hit test: find bar at a given pixel position.
 */
export function hitTestBar(
  bars: TimelineBar[],
  x: number,
  y: number,
  tolerance: number = 4,
): TimelineBar | null {
  for (const bar of bars) {
    if (bar.isMilestone) {
      // Milestones are rendered as diamonds, check diamond bounds
      const centerX = bar.x;
      const centerY = bar.y + bar.height / 2;
      const halfSize = bar.height / 2;

      // Simple bounding box for diamond
      if (
        x >= centerX - halfSize - tolerance &&
        x <= centerX + halfSize + tolerance &&
        y >= centerY - halfSize - tolerance &&
        y <= centerY + halfSize + tolerance
      ) {
        return bar;
      }
    } else {
      // Regular bar bounds
      if (
        x >= bar.x - tolerance &&
        x <= bar.x + bar.width + tolerance &&
        y >= bar.y - tolerance &&
        y <= bar.y + bar.height + tolerance
      ) {
        return bar;
      }
    }
  }

  return null;
}

/**
 * Hit test: check if position is on bar edge for resizing.
 */
export interface ResizeHit {
  bar: TimelineBar;
  edge: 'start' | 'end';
}

export function hitTestBarEdge(
  bars: TimelineBar[],
  x: number,
  y: number,
  edgeTolerance: number = 6,
): ResizeHit | null {
  for (const bar of bars) {
    // Skip milestones (can't resize)
    if (bar.isMilestone) continue;

    // Check if y is within bar bounds
    if (y < bar.y || y > bar.y + bar.height) continue;

    // Check start edge
    if (Math.abs(x - bar.x) <= edgeTolerance) {
      return { bar, edge: 'start' };
    }

    // Check end edge
    if (Math.abs(x - (bar.x + bar.width)) <= edgeTolerance) {
      return { bar, edge: 'end' };
    }
  }

  return null;
}

/**
 * Hit test: find group header at position.
 */
export function hitTestGroup(groups: TimelineGroup[], _x: number, y: number): TimelineGroup | null {
  for (const group of groups) {
    if (y >= group.y && y < group.y + 32) {
      // Header height
      return group;
    }
  }
  return null;
}

/**
 * Calculate the visible bars within a viewport.
 */
export function getVisibleBars(
  bars: TimelineBar[],
  viewportX: number,
  viewportY: number,
  viewportWidth: number,
  viewportHeight: number,
  overscan: number = 100,
): TimelineBar[] {
  const minX = viewportX - overscan;
  const maxX = viewportX + viewportWidth + overscan;
  const minY = viewportY - overscan;
  const maxY = viewportY + viewportHeight + overscan;

  return bars.filter((bar) => {
    const barRight = bar.isMilestone ? bar.x + bar.height : bar.x + bar.width;
    const barBottom = bar.y + bar.height;

    return barRight >= minX && bar.x <= maxX && barBottom >= minY && bar.y <= maxY;
  });
}
