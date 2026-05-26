/**
 * Gallery Grid Component
 *
 * Responsive grid container for gallery cards using CSS Grid.
 * Kernel-agnostic component that handles layout only.
 */

import * as React from 'react';
import { CARD_DIMENSIONS, type GalleryGridProps } from './types';

/**
 * Responsive grid that auto-fits cards based on container width.
 */
export function GalleryGrid({ cardSize, children }: GalleryGridProps): React.ReactElement {
  const dimensions = CARD_DIMENSIONS[cardSize];

  return (
    <div
      className="grid gap-4 p-4 w-full box-border"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${dimensions.width}px, 1fr))` }}
      role="rowgroup"
    >
      {children}
    </div>
  );
}
