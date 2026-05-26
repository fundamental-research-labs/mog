/**
 * SplitDividersLayer Component
 *
 * Renders draggable split dividers when split view is active.
 * Dividers are positioned based on the ViewportLayout.dividers array.
 *
 * Architecture:
 * - Reads split config from sheet meta via Sheets.getSplitConfig()
 * - Computes divider positions based on split config and container dimensions
 * - Dispatches SET_SPLIT_POSITION on drag end
 *
 */

import type { SplitViewportConfig, ViewportDivider } from '@mog-sdk/contracts/viewport';
import { memo, useCallback, useMemo } from 'react';
import { dispatch } from '../../../actions';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { useRendererStatus } from '../../../hooks/view/use-renderer-status';
import { useSplitConfig } from '../../../hooks/view/use-split-config';
import { useActiveSheetId } from '../../../infra/context';
import { SplitDivider } from './SplitDivider';
// =============================================================================
// Types
// =============================================================================

export interface SplitDividersLayerProps {
  /** Optional container dimensions override (for testing) */
  containerWidth?: number;
  containerHeight?: number;
}

// =============================================================================
// Component
// =============================================================================

/**
 * SplitDividersLayer - Renders draggable dividers for split view
 *
 * When split view is active, this component renders divider lines that
 * users can drag to adjust the split position.
 *
 * The dividers are positioned:
 * - Horizontal divider: At the vertical split position (divides top/bottom)
 * - Vertical divider: At the horizontal split position (divides left/right)
 */
export const SplitDividersLayer = memo(function SplitDividersLayer({
  containerWidth,
  containerHeight,
}: SplitDividersLayerProps) {
  const activeSheetId = useActiveSheetId();
  const deps = useActionDependencies();
  const { dimensions } = useRendererStatus();
  const { splitConfig } = useSplitConfig(activeSheetId);

  // Use renderer dimensions or provided container dimensions
  const width = containerWidth ?? dimensions.width;
  const height = containerHeight ?? dimensions.height;

  // Compute dividers based on split config
  const dividers = useMemo((): ViewportDivider[] => {
    if (!splitConfig) return [];

    const result: ViewportDivider[] = [];
    const config = splitConfig as SplitViewportConfig;

    if (config.direction === 'horizontal' || config.direction === 'both') {
      // Horizontal split: divider at vertical position
      const verticalPosition =
        'verticalPosition' in config && config.verticalPosition !== undefined
          ? config.verticalPosition
          : height / 2;

      result.push({
        type: 'split',
        orientation: 'horizontal',
        position: verticalPosition,
        draggable: true,
      });
    }

    if (config.direction === 'vertical' || config.direction === 'both') {
      // Vertical split: divider at horizontal position
      const horizontalPosition =
        'horizontalPosition' in config && config.horizontalPosition !== undefined
          ? config.horizontalPosition
          : width / 2;

      result.push({
        type: 'split',
        orientation: 'vertical',
        position: horizontalPosition,
        draggable: true,
      });
    }

    return result;
  }, [splitConfig, width, height]);

  // Handle divider drag end
  const handleDragEnd = useCallback(
    (orientation: 'horizontal' | 'vertical', position: number) => {
      dispatch('SET_SPLIT_POSITION', deps, { orientation, position });
    },
    [deps],
  );

  // Handle double-click to remove split
  const handleDoubleClick = useCallback(() => {
    dispatch('REMOVE_SPLIT', deps);
  }, [deps]);

  // Don't render anything if no split config
  if (!splitConfig || dividers.length === 0) {
    return null;
  }

  // Container bounds for clamping drag positions
  const horizontalBounds = { min: 100, max: width - 100 };
  const verticalBounds = { min: 100, max: height - 100 };

  return (
    <div
      className="split-dividers-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 4,
      }}
      data-testid="split-dividers-layer"
    >
      {dividers.map((divider, index) => (
        <SplitDivider
          key={`${divider.orientation}-${index}`}
          divider={divider}
          onDragEnd={(pos) => handleDragEnd(divider.orientation, pos)}
          onDoubleClick={handleDoubleClick}
          containerBounds={divider.orientation === 'horizontal' ? verticalBounds : horizontalBounds}
        />
      ))}
    </div>
  );
});
