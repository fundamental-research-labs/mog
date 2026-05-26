/**
 * Gallery View Types
 *
 * Kernel-agnostic types for the Gallery view component.
 * Uses plain string IDs instead of kernel-specific types.
 */

import type { CellValueOrError, ColumnInfo, KeyModifiers } from '../../types';

// =============================================================================
// Card Types
// =============================================================================

/**
 * A card in the Gallery view.
 */
export interface GalleryCard {
  /** Card ID (opaque string, maps to record/row ID) */
  id: string;
  /** Card title */
  title: string;
  /** Cover image URL (optional) */
  coverImage?: string | null;
  /** Field values to display on the card (keyed by column ID or name) */
  fields: Map<string, CellValueOrError>;
  /** Optional color indicator for the card */
  color?: string;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Card size options for gallery view.
 */
export type CardSize = 'small' | 'medium' | 'large';

/**
 * Image fit mode for cover images.
 */
export type ImageFitMode = 'cover' | 'contain';

/**
 * Card dimensions by size.
 */
export const CARD_DIMENSIONS: Record<CardSize, { width: number; height: number }> = {
  small: { width: 150, height: 180 },
  medium: { width: 200, height: 240 },
  large: { width: 280, height: 340 },
};

// =============================================================================
// State Types
// =============================================================================

/**
 * Gallery view interaction state.
 * This is passed as props from the parent (shell adapter maintains state).
 */
export interface GalleryState {
  /** Current interaction mode */
  mode: 'idle' | 'selecting';
  /** Selected card IDs */
  selectedCardIds: string[];
  /** Focused card ID (for keyboard navigation) */
  focusedCardId: string | null;
}

/**
 * Default initial state.
 */
export const initialGalleryState: GalleryState = {
  mode: 'idle',
  selectedCardIds: [],
  focusedCardId: null,
};

// =============================================================================
// Event Handler Types
// =============================================================================

/**
 * Props for Gallery component.
 */
export interface GalleryProps {
  /** Cards to display */
  cards: GalleryCard[];

  /** Current interaction state */
  state: GalleryState;

  /** Column information for field rendering */
  columnInfos?: ColumnInfo[];

  /** Card size: small (150px), medium (200px), large (280px) */
  cardSize: CardSize;

  /** How to fit cover image: 'cover' (fill) or 'contain' (fit) */
  fitMode: ImageFitMode;

  // Selection events
  /** Callback when a card is clicked */
  onCardClick?: (cardId: string, modifiers: KeyModifiers) => void;
  /** Callback when a card is double-clicked */
  onCardDoubleClick?: (cardId: string) => void;
  /** Callback when selection should be cleared */
  onClearSelection?: () => void;

  // Focus events
  /** Callback when focus changes */
  onFocusCard?: (cardId: string) => void;

  // Keyboard events
  /** Callback for keyboard events */
  onKeyDown?: (key: string, modifiers: KeyModifiers) => void;

  /** Additional CSS class name */
  className?: string;
}

/**
 * Props for GalleryCard component.
 */
export interface GalleryCardProps {
  /** Card data */
  card: GalleryCard;
  /** Card size */
  cardSize: CardSize;
  /** Image fit mode */
  fitMode: ImageFitMode;
  /** Whether card is selected */
  isSelected: boolean;
  /** Whether card is focused */
  isFocused: boolean;
  /** Column infos for field rendering */
  columnInfos?: ColumnInfo[];
  /** Click handler */
  onClick: (cardId: string, event: React.MouseEvent) => void;
  /** Double-click handler */
  onDoubleClick: (cardId: string) => void;
}

/**
 * Props for GalleryGrid component.
 */
export interface GalleryGridProps {
  /** Card size determines column width */
  cardSize: CardSize;
  /** Child card elements */
  children: React.ReactNode;
}
