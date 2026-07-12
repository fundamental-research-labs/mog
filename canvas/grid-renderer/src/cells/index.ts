/**
 * Cells Layer
 *
 * Merged cells, indicators, CF visuals, sparklines,
 * and interactive element collection.
 *
 * @module grid-renderer/cells
 */

// Merged cell handling
export {
  computeCellBounds,
  createMergeTracker,
  getMergedCellRenderInfo,
  mergeKey,
} from './merged-cells';
export type { CellBounds, MergeTracker, MergedCellRenderResult } from './merged-cells';

// Cell indicators
export {
  isTableHeaderCell,
  renderBindingStatus,
  renderCheckbox,
  renderCommentIndicator,
  renderDropdownIndicator,
  renderFilterButton,
  renderValidationError,
} from './indicators';

// Interactive elements
export {
  InteractiveElementCollectorImpl,
  createInteractiveElementCollector,
} from './interactive-element-collector';

// Data bars (conditional formatting)
export { renderDataBar, renderDataBarWithAxis } from './data-bars';
export type { DataBarRenderOptions } from './data-bars';

// Icon sets (conditional formatting)
export { getIconWidth, renderIcon } from './icon-sets';
export type { IconRenderOptions } from './icon-sets';

// Sparklines
export { SparklineRenderer, createSparklineRenderer } from './sparklines';
export type { SparklineRendererConfig } from './sparklines';

// Cell render info type
export type { CellRenderInfo } from './types';
