/**
 * Grid Canvas Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/viewport/grid-canvas.
 * Moved from @mog/spreadsheet-utils/viewport/grid-canvas (single consumer).
 */

import type { GridCanvasFeatures, GridCanvasPreset } from '@mog-sdk/contracts/grid-canvas';
import { DEFAULT_GRID_CANVAS_FEATURES, GRID_CANVAS_PRESETS } from '@mog-sdk/contracts/grid-canvas';

export function resolveGridCanvasFeatures(
  preset?: GridCanvasPreset,
  features?: GridCanvasFeatures,
): Required<GridCanvasFeatures> {
  let base = DEFAULT_GRID_CANVAS_FEATURES;

  if (preset) {
    base = GRID_CANVAS_PRESETS[preset];
  }

  if (!features) {
    return base;
  }

  return {
    editing: features.editing ?? base.editing,
    selection: features.selection ?? base.selection,
    formulas: features.formulas ?? base.formulas,
    formatting: features.formatting ?? base.formatting,
    resize: features.resize ?? base.resize,
    fill: features.fill ?? base.fill,
    contextMenu: features.contextMenu ?? base.contextMenu,
    keyboard: features.keyboard ?? base.keyboard,
    clipboard: features.clipboard ?? base.clipboard,
    collaboration: features.collaboration ?? base.collaboration,
    comments: features.comments ?? base.comments,
    charts: features.charts ?? base.charts,
    floatingObjects: features.floatingObjects ?? base.floatingObjects,
    findReplace: features.findReplace ?? base.findReplace,
  };
}
