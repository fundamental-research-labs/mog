/**
 * Gallery Card Component
 *
 * Displays a single record as a visual card with optional cover image,
 * title, and field values.
 * Kernel-agnostic: uses plain string IDs, no kernel dependencies.
 */

import React, { memo, useCallback } from 'react';
import type { CellValueOrError } from '../../types';
import { CARD_DIMENSIONS, type GalleryCardProps } from './types';

/**
 * Format a cell value for display.
 */
function formatValue(value: CellValueOrError): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'type' in value && value.type === 'error') {
    return value.code;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

/**
 * Placeholder icon for cards without images.
 */
function PlaceholderIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      className="stroke-gray-300"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21,15 16,10 5,21" />
    </svg>
  );
}

/**
 * Gallery Card renders a single record as a visual card.
 */
function GalleryCardComponent({
  card,
  cardSize,
  fitMode,
  isSelected,
  isFocused,
  columnInfos,
  onClick,
  onDoubleClick,
}: GalleryCardProps) {
  const dimensions = CARD_DIMENSIONS[cardSize];

  // Click handler
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      onClick(card.id, event);
    },
    [onClick, card.id],
  );

  // Double-click handler
  const handleDoubleClick = useCallback(() => {
    onDoubleClick(card.id);
  }, [onDoubleClick, card.id]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onDoubleClick(card.id);
      }
    },
    [onDoubleClick, card.id],
  );

  // Calculate image height (roughly 60% of card height for medium/large, 50% for small)
  const imageHeightRatio = cardSize === 'small' ? 0.5 : 0.6;
  const imageHeight = Math.round(dimensions.height * imageHeightRatio);

  // Build class names
  const borderClasses = isSelected
    ? 'border-2 border-blue-500'
    : isFocused
      ? 'border-2 border-blue-300'
      : 'border border-gray-200';

  const shadowClasses = isSelected ? 'shadow-md' : 'shadow-sm';
  const paddingClasses = cardSize === 'small' ? 'p-2' : 'p-3';
  const titleClasses = cardSize === 'small' ? 'text-sm' : 'text-base';
  const fieldClasses = cardSize === 'small' ? 'text-xs' : 'text-sm';

  // Dynamic styles for image
  const imageStyle: React.CSSProperties = {
    objectFit: fitMode,
  };

  // Build column info map for field name lookup
  const columnInfoMap = new Map(columnInfos?.map((c) => [c.id, c]) ?? []);

  // Calculate max fields to show based on card size
  const maxFields = cardSize === 'small' ? 2 : cardSize === 'medium' ? 3 : 4;

  return (
    <div
      className={`flex flex-col w-full bg-white rounded-md cursor-pointer overflow-hidden transition-all outline-none ${borderClasses} ${shadowClasses} hover:shadow-md`}
      style={{ minHeight: dimensions.height }}
      role="gridcell"
      tabIndex={0}
      aria-selected={isSelected}
      data-card-id={card.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {/* Cover image area */}
      <div
        className="w-full bg-gray-50 flex items-center justify-center overflow-hidden"
        style={{ height: imageHeight }}
      >
        {card.coverImage ? (
          <img
            src={card.coverImage}
            alt={card.title}
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
          className={`${titleClasses} font-semibold text-gray-900 m-0 overflow-hidden text-ellipsis whitespace-nowrap`}
          title={card.title}
        >
          {card.title || '(Untitled)'}
        </h3>

        {/* Field values */}
        {card.fields.size > 0 && (
          <div className="space-y-0.5">
            {Array.from(card.fields.entries())
              .slice(0, maxFields)
              .map(([fieldId, value]) => {
                const columnInfo = columnInfoMap.get(fieldId);
                const label = columnInfo?.name || fieldId;
                return (
                  <div
                    key={fieldId}
                    className={`${fieldClasses} text-gray-600 overflow-hidden text-ellipsis whitespace-nowrap`}
                  >
                    <span className="font-medium text-gray-500">{label}:</span>{' '}
                    <span>{formatValue(value)}</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const GalleryCard = memo(GalleryCardComponent, (prev, next) => {
  // Custom comparison for performance
  if (prev.card.id !== next.card.id) return false;
  if (prev.card.title !== next.card.title) return false;
  if (prev.card.coverImage !== next.card.coverImage) return false;
  if (prev.cardSize !== next.cardSize) return false;
  if (prev.fitMode !== next.fitMode) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isFocused !== next.isFocused) return false;

  return true;
});

GalleryCard.displayName = 'GalleryCard';
