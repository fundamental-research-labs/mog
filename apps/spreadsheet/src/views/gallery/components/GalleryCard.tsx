/**
 * Gallery Card Component
 *
 * Displays a single record as a visual card with optional cover image,
 * title, and field values.
 */

import type { RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import { KeyboardEventProcessor } from '@mog-sdk/kernel/keyboard';
import * as React from 'react';
import { CardFieldDisplay } from '../../../components/column-renderers';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { GalleryCardSize, GalleryFitMode } from '../config';
import { detectPlatform } from '../../../utils/platform';
import { CARD_DIMENSIONS } from '../config';

export interface CardField {
  /** Column ID */
  colId: string;
  /** Column name for display */
  name: string;
  /** Cell value */
  value: CellValue;
  /** Column schema for rich rendering */
  column: ColumnSchema;
}

export interface GalleryCardProps {
  /** Row ID of the record */
  rowId: RowId;
  /** Card title */
  title: string;
  /** Cover image URL (optional) */
  coverImageUrl?: string | null;
  /** Fields to display below title */
  fields: CardField[];
  /** Card size */
  cardSize: GalleryCardSize;
  /** Image fit mode */
  fitMode: GalleryFitMode;
  /** Whether the card is selected */
  isSelected: boolean;
  /** Whether the card has keyboard focus */
  isFocused: boolean;
  /** Click handler */
  onClick: (rowId: RowId, event: React.MouseEvent) => void;
  /** Double-click handler */
  onDoubleClick: (rowId: RowId) => void;
}

/**
 * Gallery Card renders a single record as a visual card.
 */
export function GalleryCard({
  rowId,
  title,
  coverImageUrl,
  fields,
  cardSize,
  fitMode,
  isSelected,
  isFocused,
  onClick,
  onDoubleClick,
}: GalleryCardProps): React.ReactElement {
  const dimensions = CARD_DIMENSIONS[cardSize];

  const handleClick = React.useCallback(
    (event: React.MouseEvent) => {
      onClick(rowId, event);
    },
    [rowId, onClick],
  );

  const handleDoubleClick = React.useCallback(() => {
    onDoubleClick(rowId);
  }, [rowId, onDoubleClick]);

  const processor = React.useMemo(() => new KeyboardEventProcessor(detectPlatform()), []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const input = processor.process(event.nativeEvent);
      if (input.isComposing) return;
      if (input.physicalKey === 'Enter') {
        onDoubleClick(rowId);
      }
    },
    [rowId, onDoubleClick, processor],
  );

  // Calculate image height (roughly 60% of card height for medium/large, 50% for small)
  const imageHeightRatio = cardSize === 'small' ? 0.5 : 0.6;
  const imageHeight = Math.round(dimensions.height * imageHeightRatio);

  // Use Tailwind classes with design tokens
  const borderClasses = isSelected
    ? 'border-2 border-ss-primary'
    : isFocused
      ? 'border-2 border-ss-primary-light'
      : 'border border-ss-border';

  const shadowClasses = isSelected ? 'shadow-ss-md' : 'shadow-ss-sm';

  const paddingClasses = cardSize === 'small' ? 'p-2' : 'p-3';
  const titleClasses = cardSize === 'small' ? 'text-body-sm' : 'text-body';
  const fieldClasses = cardSize === 'small' ? 'text-hint' : 'text-caption';

  // Dynamic styles that need inline values
  const imageStyle: React.CSSProperties = {
    objectFit: fitMode,
  };

  // Placeholder icon for cards without images - using design token color via CSS variable
  const PlaceholderIcon = () => (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      className="stroke-ss-text-disabled"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21,15 16,10 5,21" />
    </svg>
  );

  return (
    <div
      className={`flex flex-col w-full bg-ss-surface rounded-ss-md cursor-pointer overflow-hidden transition-all outline-none ${borderClasses} ${shadowClasses}`}
      style={{ minHeight: dimensions.height }}
      role="gridcell"
      tabIndex={0}
      aria-selected={isSelected}
      data-row-id={rowId}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Cover image area */}
      <div
        className="w-full bg-ss-surface-tertiary flex items-center justify-center overflow-hidden"
        style={{ height: imageHeight }}
      >
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={title}
            className="w-full h-full"
            style={imageStyle}
            loading="lazy"
          />
        ) : (
          <PlaceholderIcon />
        )}
      </div>

      {/* Content area */}
      <div className={`${paddingClasses} flex-1 flex flex-col gap-1`}>
        <h3
          className={`${titleClasses} font-semibold text-ss-text m-0 overflow-hidden text-ellipsis whitespace-nowrap`}
          title={title}
        >
          {title}
        </h3>

        {/* Field values */}
        {fields.slice(0, cardSize === 'small' ? 2 : cardSize === 'medium' ? 3 : 4).map((field) => (
          <div
            key={field.colId}
            className={`${fieldClasses} text-ss-text-secondary overflow-hidden text-ellipsis whitespace-nowrap`}
          >
            <span className="font-medium mr-1">{field.name}:</span>
            <CardFieldDisplay
              value={field.value}
              column={field.column}
              compact={cardSize === 'small'}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
