/**
 * Gallery Component
 *
 * Displays records as visual cards in a responsive grid.
 * Kernel-agnostic: uses plain string IDs, no kernel dependencies.
 *
 * Features:
 * - Responsive grid layout
 * - Card selection (single, multi with shift/ctrl)
 * - Keyboard navigation
 * - Cover images with configurable fit mode
 * - Configurable card sizes
 */

import React, { useCallback, useRef } from 'react';
import type { KeyModifiers } from '../../types';
import { GalleryCard } from './GalleryCard';
import { GalleryGrid } from './GalleryGrid';
import type { GalleryProps } from './types';

/**
 * Gallery view renders records as visual cards in a responsive grid.
 */
export function Gallery({
  cards,
  state,
  columnInfos,
  cardSize,
  fitMode,
  onCardClick,
  onCardDoubleClick,
  onClearSelection,
  onFocusCard: _onFocusCard,
  onKeyDown,
  className,
}: GalleryProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  // Build selection set for quick lookups
  const selectedSet = new Set(state.selectedCardIds);

  // Handle card click
  const handleCardClick = useCallback(
    (cardId: string, event: React.MouseEvent) => {
      const modifiers: KeyModifiers = {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      };
      onCardClick?.(cardId, modifiers);
    },
    [onCardClick],
  );

  // Handle card double-click
  const handleCardDoubleClick = useCallback(
    (cardId: string) => {
      onCardDoubleClick?.(cardId);
    },
    [onCardDoubleClick],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const modifiers: KeyModifiers = {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      };

      // Escape key clears selection
      if (event.key === 'Escape') {
        event.preventDefault();
        onClearSelection?.();
        return;
      }

      // Pass keyboard events to parent handler
      onKeyDown?.(event.key, modifiers);
    },
    [onKeyDown, onClearSelection],
  );

  // Handle container click (background)
  const handleContainerClick = useCallback(
    (event: React.MouseEvent) => {
      // Only clear selection if clicking the container itself (not a card)
      if (event.target === event.currentTarget) {
        onClearSelection?.();
      }
    },
    [onClearSelection],
  );

  // Render empty state
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <span>No records to display</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full h-full overflow-auto outline-none ${className || ''}`}
      tabIndex={0}
      role="grid"
      aria-label="Gallery view"
      onKeyDown={handleKeyDown}
      onClick={handleContainerClick}
    >
      <GalleryGrid cardSize={cardSize}>
        {cards.map((card) => (
          <GalleryCard
            key={card.id}
            card={card}
            cardSize={cardSize}
            fitMode={fitMode}
            isSelected={selectedSet.has(card.id)}
            isFocused={state.focusedCardId === card.id}
            columnInfos={columnInfos}
            onClick={handleCardClick}
            onDoubleClick={handleCardDoubleClick}
          />
        ))}
      </GalleryGrid>
    </div>
  );
}
