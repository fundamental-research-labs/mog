/**
 * Slicer Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/data/slicers.
 */

import type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import type {
  SlicerConfig,
  SlicerPivotSource,
  SlicerSource,
  SlicerStyle,
  SlicerTableSource,
  TimelineSlicerConfig,
} from '@mog-sdk/contracts/data/slicers';
import type { AnchorMode, FloatingObjectAnchor } from '../../bridges/compute/compute-types.gen';

export function isTableSlicerSource(source: SlicerSource): source is SlicerTableSource {
  return source.type === 'table';
}

export function isPivotSlicerSource(source: SlicerSource): source is SlicerPivotSource {
  return source.type === 'pivot';
}

export function isTimelineSlicerConfig(config: SlicerConfig): config is TimelineSlicerConfig {
  return 'sourceType' in config && (config as TimelineSlicerConfig).sourceType === 'timeline';
}

export function getQuarterFromMonth(month: number): number {
  return Math.ceil(month / 3);
}

export function getQuarterLabel(quarter: number): string {
  return `Q${quarter}`;
}

export const DEFAULT_SLICER_STYLE: SlicerStyle = {
  preset: 'light1',
  columnCount: 1,
  buttonHeight: 24,
  showSelectionIndicator: true,
  crossFilter: 'showItemsWithDataAtTop',
  customListSort: true,
  showItemsWithNoData: true,
  sortOrder: 'ascending',
};

export const DEFAULT_TIMELINE_STYLE: TimelineSlicerConfig['style'] = {
  preset: 'light1',
  columnCount: 1,
  buttonHeight: 24,
  showSelectionIndicator: true,
  crossFilter: 'showItemsWithDataAtTop',
  customListSort: true,
  showItemsWithNoData: true,
  sortOrder: 'ascending',
};

// =============================================================================
// Position (ObjectPosition ↔ FloatingObjectAnchor) conversion
// =============================================================================

/** English Metric Units per pixel at 96 DPI (1 px = 9525 EMU). */
const EMU_PER_PX = 9525;

/** Map the UI `ObjectPosition.anchorType` to the Rust `AnchorMode` enum. */
function anchorTypeToMode(anchorType: ObjectPosition['anchorType'] | undefined): AnchorMode {
  switch (anchorType) {
    case 'oneCell':
      return 'oneCell';
    case 'twoCell':
      return 'twoCell';
    case 'absolute':
    default:
      return 'absolute';
  }
}

/** Map the Rust `AnchorMode` back to the UI `ObjectPosition.anchorType`. */
function anchorModeToType(mode: AnchorMode): ObjectPosition['anchorType'] {
  switch (mode) {
    case 'oneCell':
      return 'oneCell';
    case 'twoCell':
      return 'twoCell';
    case 'absolute':
    default:
      return 'absolute';
  }
}

/**
 * Convert a UI `ObjectPosition` (cellId-anchored, pixel offsets) to a
 * `FloatingObjectAnchor` (row/col-anchored, EMU offsets) that Rust
 * `StoredSlicer.position` requires.
 *
 * Row/column resolution from `CellId` is not performed here; the `from`
 * cell is treated as row=0, col=0 when the caller hasn't provided
 * positional anchoring. For absolute-anchored slicers this is
 * semantically fine: the EMU offsets fully describe the position.
 */
export function objectPositionToAnchor(pos: ObjectPosition): FloatingObjectAnchor {
  const anchor: FloatingObjectAnchor = {
    anchorRow: 0,
    anchorCol: 0,
    anchorRowOffsetEmu: Math.round((pos.y ?? pos.from.yOffset ?? 0) * EMU_PER_PX),
    anchorColOffsetEmu: Math.round((pos.x ?? pos.from.xOffset ?? 0) * EMU_PER_PX),
    anchorMode: anchorTypeToMode(pos.anchorType),
  };
  if (pos.width != null) {
    anchor.extentCxEmu = Math.round(pos.width * EMU_PER_PX);
  }
  if (pos.height != null) {
    anchor.extentCyEmu = Math.round(pos.height * EMU_PER_PX);
  }
  return anchor;
}

/**
 * Inverse of {@link objectPositionToAnchor}. Builds an `ObjectPosition`
 * with pixel coordinates from a Rust `FloatingObjectAnchor`.
 *
 * The `from.cellId` is emitted as the empty string when the anchor does
 * not carry a `CellId`; callers that need a stable cell reference must
 * resolve it separately.
 */
export function anchorToObjectPosition(anchor: FloatingObjectAnchor): ObjectPosition {
  const position: ObjectPosition = {
    anchorType: anchorModeToType(anchor.anchorMode),
    from: {
      cellId: '' as ObjectPosition['from']['cellId'],
      xOffset: 0,
      yOffset: 0,
    },
    x: anchor.anchorColOffsetEmu / EMU_PER_PX,
    y: anchor.anchorRowOffsetEmu / EMU_PER_PX,
  };
  if (anchor.extentCxEmu != null) {
    position.width = anchor.extentCxEmu / EMU_PER_PX;
  }
  if (anchor.extentCyEmu != null) {
    position.height = anchor.extentCyEmu / EMU_PER_PX;
  }
  return position;
}
