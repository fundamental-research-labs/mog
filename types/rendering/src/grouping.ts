/**
 * Grouping Data Types
 *
 * Types for row/column grouping (outlines) used by hit testing and rendering.
 *
 * @module @mog-sdk/contracts/rendering/grouping
 */

import type { GroupDefinition, SheetGroupingConfig } from '@mog/types-data/data/grouping';

/**
 * Grouping data for outline hit testing.
 * This interface is used by the HitTestService to perform hit tests
 * without requiring a full RenderContext.
 */
export interface GroupingData {
  config: SheetGroupingConfig | null;
  rowGroups: GroupDefinition[];
  columnGroups: GroupDefinition[];
  maxRowLevel: number;
  maxColLevel: number;
}
