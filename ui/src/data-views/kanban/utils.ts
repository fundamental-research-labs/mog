/**
 * Kanban Utilities
 *
 * Helper functions for Kanban board operations.
 * Kernel-agnostic: uses plain string IDs.
 */

import type { KanbanColumn } from './types';

/**
 * Get all card IDs from all columns in order.
 */
export function getAllCardIds(columns: KanbanColumn[]): string[] {
  return columns.flatMap((col) => col.cards.map((card) => card.id));
}

/**
 * Find a card by its ID across all columns.
 */
export function findCard(
  columns: KanbanColumn[],
  cardId: string,
): { card: KanbanColumn['cards'][0]; column: KanbanColumn } | undefined {
  for (const column of columns) {
    const card = column.cards.find((c) => c.id === cardId);
    if (card) {
      return { card, column };
    }
  }
  return undefined;
}

/**
 * Find the column containing a specific card.
 */
export function findCardColumn(columns: KanbanColumn[], cardId: string): KanbanColumn | undefined {
  return columns.find((col) => col.cards.some((card) => card.id === cardId));
}

/**
 * Get the next card ID for keyboard navigation.
 *
 * @param columns - All columns with cards
 * @param currentCardId - ID of currently focused card
 * @param direction - Direction to navigate
 * @returns The next card ID, or null if there's no next card in that direction
 */
export function getNextCardId(
  columns: KanbanColumn[],
  currentCardId: string,
  direction: 'up' | 'down' | 'left' | 'right',
): string | null {
  // Find current card position
  let colIndex = -1;
  let cardIndex = -1;

  for (let c = 0; c < columns.length; c++) {
    const column = columns[c];
    for (let r = 0; r < column.cards.length; r++) {
      if (column.cards[r].id === currentCardId) {
        colIndex = c;
        cardIndex = r;
        break;
      }
    }
    if (colIndex >= 0) break;
  }

  // Card not found
  if (colIndex < 0 || cardIndex < 0) return null;

  switch (direction) {
    case 'up': {
      // Move up within column
      if (cardIndex > 0) {
        return columns[colIndex].cards[cardIndex - 1].id;
      }
      return null;
    }
    case 'down': {
      // Move down within column
      if (cardIndex < columns[colIndex].cards.length - 1) {
        return columns[colIndex].cards[cardIndex + 1].id;
      }
      return null;
    }
    case 'left': {
      // Move to previous column at same position (or closest)
      if (colIndex > 0) {
        const prevColumn = columns[colIndex - 1];
        if (prevColumn.cards.length === 0) {
          // Skip empty columns
          return getNextCardId(columns, prevColumn.cards[0]?.id || currentCardId, 'left');
        }
        const targetIndex = Math.min(cardIndex, prevColumn.cards.length - 1);
        if (targetIndex >= 0) {
          return prevColumn.cards[targetIndex].id;
        }
      }
      return null;
    }
    case 'right': {
      // Move to next column at same position (or closest)
      if (colIndex < columns.length - 1) {
        const nextColumn = columns[colIndex + 1];
        if (nextColumn.cards.length === 0) {
          // Skip empty columns
          return getNextCardId(columns, nextColumn.cards[0]?.id || currentCardId, 'right');
        }
        const targetIndex = Math.min(cardIndex, nextColumn.cards.length - 1);
        if (targetIndex >= 0) {
          return nextColumn.cards[targetIndex].id;
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Get the first card ID in the board (for initial focus).
 */
export function getFirstCardId(columns: KanbanColumn[]): string | null {
  for (const column of columns) {
    if (column.cards.length > 0) {
      return column.cards[0].id;
    }
  }
  return null;
}

/**
 * Get the last card ID in the board.
 */
export function getLastCardId(columns: KanbanColumn[]): string | null {
  for (let i = columns.length - 1; i >= 0; i--) {
    const column = columns[i];
    if (column.cards.length > 0) {
      return column.cards[column.cards.length - 1].id;
    }
  }
  return null;
}
