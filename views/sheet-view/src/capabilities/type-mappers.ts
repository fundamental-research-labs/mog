/**
 * Type Mappers — convert between internal renderer types and public types.
 *
 * These mapping functions live at the boundary between the capability
 * implementations (package-private) and the internal renderer objects.
 * They ensure no internal types leak through the public capability API.
 *
 * @module @mog-sdk/sheet-view/capabilities/type-mappers
 */

import type { MergeRegion as InternalMergeRegion } from '@mog/grid-renderer';
import type {
  CellHitResult,
  ColumnHeaderHitResult,
  ColumnResizeHitResult,
  CommentIndicatorHitResult,
  FloatingObjectHitResult,
  FrozenHitResult,
  HiddenColumnBoundaryHitResult,
  HiddenRowBoundaryHitResult,
  OutlineCollapseButtonHitResult,
  OutlineLevelButtonHitResult,
  RowHeaderHitResult,
  RowResizeHitResult,
  UnifiedHitResult,
} from '@mog-sdk/contracts/rendering';

import type { MergeRegion, ObjectBounds, SheetHitResult } from '../public-types';

// =============================================================================
// Hit Test Result Mapping
// =============================================================================

/**
 * Maps an internal UnifiedHitResult to the public SheetHitResult type.
 *
 * Every variant of the internal union must be handled here. If new
 * internal variants are added, this function must be updated — the
 * TypeScript compiler will catch exhaustiveness via the default branch.
 */
export function mapHitResult(hit: UnifiedHitResult): SheetHitResult {
  switch (hit.type) {
    case 'cell':
      return {
        type: 'cell',
        row: (hit as CellHitResult).row,
        col: (hit as CellHitResult).col,
      };

    case 'columnHeader':
      return {
        type: 'column-header',
        col: (hit as ColumnHeaderHitResult).col,
      };

    case 'rowHeader':
      return {
        type: 'row-header',
        row: (hit as RowHeaderHitResult).row,
      };

    case 'columnResize':
      return {
        type: 'column-resize-handle',
        col: (hit as ColumnResizeHitResult).col,
      };

    case 'rowResize':
      return {
        type: 'row-resize-handle',
        row: (hit as RowResizeHitResult).row,
      };

    case 'fillHandle':
      return { type: 'fill-handle' };

    case 'frozen': {
      const frozen = hit as FrozenHitResult;
      return {
        type: 'frozen-pane-region',
        region: frozen.region,
      };
    }

    case 'selectAll':
      return { type: 'select-all' };

    case 'empty':
      return { type: 'empty' };

    case 'outlineLevelButton': {
      const olb = hit as OutlineLevelButtonHitResult;
      return {
        type: 'outline-level-button',
        axis: olb.axis,
        level: olb.level,
      };
    }

    case 'outlineCollapseButton': {
      const ocb = hit as OutlineCollapseButtonHitResult;
      return {
        type: 'outline-collapse-button',
        axis: ocb.axis,
        groupId: ocb.groupId,
        collapsed: ocb.collapsed,
      };
    }

    case 'outlineGutter': {
      // OutlineGutterHitResult is part of the union but not re-exported
      // from the rendering barrel, so access fields via cast.
      const og = hit as unknown as { orientation: 'row' | 'column' };
      return {
        type: 'outline-gutter',
        orientation: og.orientation,
      };
    }

    case 'hiddenColumnBoundary': {
      const hcb = hit as HiddenColumnBoundaryHitResult;
      return {
        type: 'hidden-column-boundary',
        col: hcb.col,
        hiddenStart: hcb.hiddenStart,
        hiddenEnd: hcb.hiddenEnd,
      };
    }

    case 'hiddenRowBoundary': {
      const hrb = hit as HiddenRowBoundaryHitResult;
      return {
        type: 'hidden-row-boundary',
        row: hrb.row,
        hiddenStart: hrb.hiddenStart,
        hiddenEnd: hrb.hiddenEnd,
      };
    }

    case 'commentIndicator': {
      const ci = hit as CommentIndicatorHitResult;
      return {
        type: 'comment-indicator',
        row: ci.row,
        col: ci.col,
      };
    }

    case 'floatingObject': {
      const fo = hit as FloatingObjectHitResult;
      return {
        type: 'floating-object',
        objectId: fo.objectId,
        region: fo.region,
        isGroup: fo.isGroup,
      };
    }

    default:
      // Exhaustiveness guard — if a new internal variant is added,
      // TypeScript will error here (assuming strict checks).
      return { type: 'empty' };
  }
}

// =============================================================================
// Merge Region Mapping
// =============================================================================

/**
 * Map an internal MergeRegion to the public MergeRegion type.
 */
export function mapMergeRegion(region: InternalMergeRegion): MergeRegion {
  return {
    startRow: region.startRow,
    startCol: region.startCol,
    endRow: region.endRow,
    endCol: region.endCol,
  };
}

// =============================================================================
// Object Bounds Mapping
// =============================================================================

/**
 * Map internal ObjectBounds to public ObjectBounds.
 * Internal bounds come from @mog-sdk/contracts/rendering.
 */
export function mapObjectBoundsToPublic(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}): ObjectBounds {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: bounds.rotation,
  };
}

/**
 * Map public ObjectBounds to internal ObjectBoundsUpdate format.
 */
export function mapPublicBoundsToInternal(bounds: ObjectBounds): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
} {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: bounds.rotation,
  };
}
