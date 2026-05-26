/**
 * Gallery View Component
 *
 * Displays table records as visual cards in a responsive grid.
 * Optimized for image-heavy content like inventory management.
 *
 * Uses XState state machine from adapter for selection management.
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { RowId } from '@mog-sdk/contracts/cell-identity';
import { useSelector } from '@xstate/react';
import * as React from 'react';
import type { TableId } from '../types';
import { GalleryCard } from './components/GalleryCard';
import { GalleryGrid } from './components/GalleryGrid';
import type { GalleryViewConfig } from './config';
import { useGalleryData } from './hooks/use-gallery-data';
import { GalleryEvents, getGallerySnapshot, type GalleryActor } from './machines';

/**
 * Subset of GalleryViewAdapter methods that GalleryView actually uses.
 * This allows GalleryViewContainer to pass a lightweight adapter-like object
 * without implementing the full ViewAdapter interface.
 */
export interface GalleryViewAdapterLike {
  getActor(): GalleryActor;
  getTableId(): TableId;
  setAllCardIds(cardIds: RowId[]): void;
  handleKeyboard(event: KeyboardEvent): boolean;
}

export interface GalleryViewProps {
  /** The adapter managing this view's state */
  adapter: GalleryViewAdapterLike;
  /** View configuration */
  config: GalleryViewConfig;
  /** Workbook API for data access */
  workbook?: Workbook | null;
  /** Callback when a card is clicked */
  onCardClick?: (rowId: RowId) => void;
  /** Callback when a card is double-clicked (open detail) */
  onCardDoubleClick?: (rowId: RowId) => void;
}

/**
 * Gallery View renders records as visual cards in a responsive grid.
 */
export function GalleryView({
  adapter,
  config,
  workbook,
  onCardClick,
  onCardDoubleClick,
}: GalleryViewProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Get the state machine actor from adapter
  const actor = adapter.getActor();

  // Subscribe to machine state using XState selector
  const snapshot = useSelector(actor, getGallerySnapshot);
  const selectedCards = React.useMemo(
    () => new Set(snapshot.selectedCards),
    [snapshot.selectedCards],
  );
  const focusedCard = snapshot.focusedCard;

  // Get data for the gallery
  const { records, loading, error } = useGalleryData({
    workbook: workbook ?? null,
    tableId: adapter.getTableId(),
    config: {
      titleColumn: config.titleColumn,
      coverImageColumn: config.coverImageColumn,
      cardFields: config.cardFields,
    },
  });

  // Update adapter with all card IDs for selectAll functionality
  React.useEffect(() => {
    adapter.setAllCardIds(records.map((r) => r.id));
  }, [adapter, records]);

  // Handle card click
  const handleCardClick = React.useCallback(
    (rowId: RowId, event: React.MouseEvent) => {
      const modifiers = {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      };
      actor.send(GalleryEvents.cardClick(rowId, modifiers));
      onCardClick?.(rowId);
    },
    [actor, onCardClick],
  );

  // Handle card double-click
  const handleCardDoubleClick = React.useCallback(
    (rowId: RowId) => {
      actor.send(GalleryEvents.cardDoubleClick(rowId));
      onCardDoubleClick?.(rowId);
    },
    [actor, onCardDoubleClick],
  );

  // Handle keyboard navigation
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (adapter.handleKeyboard(event)) {
        event.preventDefault();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [adapter]);

  // Render loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ss-text-secondary">
        <div className="animate-ss-spin w-6 h-6 border-2 border-ss-primary border-t-transparent rounded-full" />
        <span className="mt-2">Loading...</span>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ss-error">
        <span>Error loading data: {error.message}</span>
      </div>
    );
  }

  // Render empty state
  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-ss-text-secondary">
        <span>No records to display</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto outline-none"
      tabIndex={0}
      role="grid"
      aria-label="Gallery view"
    >
      <GalleryGrid cardSize={config.cardSize}>
        {records.map((record) => (
          <GalleryCard
            key={record.id}
            rowId={record.id}
            title={record.title}
            coverImageUrl={record.coverImageUrl}
            fields={record.fields}
            cardSize={config.cardSize}
            fitMode={config.fitMode}
            isSelected={selectedCards.has(record.id)}
            isFocused={focusedCard === record.id}
            onClick={handleCardClick}
            onDoubleClick={handleCardDoubleClick}
          />
        ))}
      </GalleryGrid>
    </div>
  );
}

// Styles are now using Tailwind classes with design tokens
// See tokens.css for available design token values
