/**
 * Gallery View Configuration
 *
 * Defines the configuration type and defaults for Gallery views.
 * Gallery view displays records as visual cards in a responsive grid,
 * optimized for image-heavy content like inventory management.
 */

import type { ColId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { TableId, ViewConfigBase, ViewId } from '../types';

/**
 * Card size options for gallery view.
 */
export type GalleryCardSize = 'small' | 'medium' | 'large';

/**
 * Image fit mode for cover images.
 */
export type GalleryFitMode = 'cover' | 'contain';

/**
 * Card dimensions by size.
 */
export const CARD_DIMENSIONS: Record<GalleryCardSize, { width: number; height: number }> = {
  small: { width: 150, height: 180 },
  medium: { width: 200, height: 240 },
  large: { width: 280, height: 340 },
};

/**
 * Full Gallery view configuration.
 */
export interface GalleryViewConfig extends ViewConfigBase {
  /** Optional column containing cover image (file/attachment column) */
  coverImageColumn?: ColId;

  /** Column to use as card title */
  titleColumn: ColId;

  /** Fields to show on card below the title */
  cardFields: ColId[];

  /** Card size: small (150px), medium (200px), large (280px) */
  cardSize: GalleryCardSize;

  /** How to fit cover image: 'cover' (fill) or 'contain' (fit) */
  fitMode: GalleryFitMode;
}

/**
 * Default Gallery view configuration.
 * Used when creating new Gallery views without full config.
 */
export const DEFAULT_GALLERY_CONFIG: Partial<GalleryViewConfig> = {
  cardFields: [],
  cardSize: 'medium',
  fitMode: 'cover',
};

/**
 * Create a full Gallery config from partial input.
 */
export function createGalleryConfig(
  viewId: ViewId,
  sheetId: SheetId,
  tableId: TableId,
  titleColumn: ColId,
  partial: Partial<GalleryViewConfig> = {},
): GalleryViewConfig {
  return {
    viewId,
    sheetId,
    tableId,
    titleColumn,
    coverImageColumn: partial.coverImageColumn,
    cardFields: partial.cardFields ?? [],
    cardSize: partial.cardSize ?? 'medium',
    fitMode: partial.fitMode ?? 'cover',
  };
}
