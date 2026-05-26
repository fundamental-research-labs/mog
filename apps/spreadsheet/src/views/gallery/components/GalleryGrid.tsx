/**
 * Gallery Grid Component
 *
 * Responsive grid container for gallery cards using CSS Grid.
 */

import * as React from 'react';
import type { GalleryCardSize } from '../config';
import { CARD_DIMENSIONS } from '../config';

export interface GalleryGridProps {
  /** Card size determines column width */
  cardSize: GalleryCardSize;
  /** Child card elements */
  children: React.ReactNode;
}

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
