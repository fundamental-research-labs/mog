/**
 * Kanban Board Types
 *
 * Kernel-agnostic types for the Kanban board component.
 * Uses plain string IDs instead of kernel-specific types.
 */

import type { CellValueOrError, ColumnInfo, KeyModifiers } from '../../types';

// =============================================================================
// Card Types
// =============================================================================

/**
 * A card in the Kanban board.
 */
export interface KanbanCard {
  /** Card ID (opaque string, maps to record/row ID) */
  id: string;
  /** Card title */
  title: string;
  /** Group value (determines which column the card is in) */
  groupValue: string;
  /** Field values to display on the card (keyed by column ID or name) */
  fields: Map<string, CellValueOrError>;
  /** Optional color indicator for the card */
  color?: string;
}

/**
 * A column in the Kanban board.
 */
export interface KanbanColumn {
  /** Column value (from groupBy field) */
  value: string;
  /** Display label */
  label: string;
  /** Optional color for the column header */
  color?: string;
  /** Cards in this column */
  cards: KanbanCard[];
  /** Whether the column is collapsed */
  isCollapsed: boolean;
  /** Work-in-progress limit (if set) */
  wipLimit?: number;
  /** Whether WIP limit is exceeded */
  isOverLimit: boolean;
}

// =============================================================================
// State Types
// =============================================================================

/**
 * Kanban board interaction state.
 * This is passed as props from the parent (shell adapter maintains state).
 */
export interface KanbanState {
  /** Current interaction mode */
  mode: 'idle' | 'selecting' | 'dragging' | 'editing' | 'adding';
  /** Selected card IDs */
  selectedCardIds: string[];
  /** Focused card ID (for keyboard navigation) */
  focusedCardId: string | null;
  /** Card being dragged */
  draggedCardId: string | null;
  /** Column value being dragged over */
  draggedOverColumn: string | null;
  /** Drop position within column */
  dropPosition: { column: string; index: number } | null;
  /** Card being edited */
  editingCardId: string | null;
  /** Column where new card is being added */
  addingInColumn: string | null;
}

/**
 * Default initial state.
 */
export const initialKanbanState: KanbanState = {
  mode: 'idle',
  selectedCardIds: [],
  focusedCardId: null,
  draggedCardId: null,
  draggedOverColumn: null,
  dropPosition: null,
  editingCardId: null,
  addingInColumn: null,
};

// =============================================================================
// Event Handler Types
// =============================================================================

/**
 * Props for KanbanBoard component.
 */
export interface KanbanBoardProps {
  /** Columns with their cards */
  columns: KanbanColumn[];

  /** Current interaction state */
  state: KanbanState;

  /** Column information for field rendering */
  columnInfos?: ColumnInfo[];

  // Selection events
  /** Callback when a card is clicked */
  onCardClick?: (cardId: string, modifiers: KeyModifiers) => void;
  /** Callback when a card is double-clicked */
  onCardDoubleClick?: (cardId: string) => void;
  /** Callback when selection should be cleared */
  onClearSelection?: () => void;

  // Drag and drop events
  /** Callback when drag starts */
  onDragStart?: (cardId: string) => void;
  /** Callback when dragging over a column */
  onDragOver?: (column: string, index: number) => void;
  /** Callback when drag ends (cancelled) */
  onDragEnd?: () => void;
  /** Callback when a card is dropped */
  onDrop?: (cardId: string, targetColumn: string, targetIndex: number) => void;

  // Card management events
  /** Callback to start adding a new card */
  onStartAddCard?: (columnValue: string) => void;
  /** Callback to commit adding a new card */
  onCommitAddCard?: (columnValue: string, title: string) => void;
  /** Callback to cancel adding a new card */
  onCancelAddCard?: () => void;

  // Column events
  /** Callback to toggle column collapse */
  onToggleCollapse?: (columnValue: string) => void;

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
 * Props for KanbanColumn component.
 */
export interface KanbanColumnProps {
  /** Column data */
  column: KanbanColumn;
  /** Current state */
  state: KanbanState;
  /** Column infos for field rendering */
  columnInfos?: ColumnInfo[];
  /** Card click handler */
  onCardClick: (cardId: string, event: React.MouseEvent) => void;
  /** Card double-click handler */
  onCardDoubleClick: (cardId: string) => void;
  /** Drag handlers */
  onDragStart: (event: React.DragEvent, cardId: string, columnValue: string) => void;
  onDragOver: (event: React.DragEvent, columnValue: string, index: number) => void;
  onDragEnter: (event: React.DragEvent, columnValue: string) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent, columnValue: string, index: number) => void;
  onDragEnd: (event: React.DragEvent) => void;
  /** Add card handlers */
  onStartAddCard: (columnValue: string) => void;
  onCommitAddCard: (columnValue: string, title: string) => void;
  onCancelAddCard: () => void;
  /** Collapse handler */
  onToggleCollapse: (columnValue: string) => void;
}

/**
 * Props for KanbanCard component.
 */
export interface KanbanCardProps {
  /** Card data */
  card: KanbanCard;
  /** Column this card belongs to */
  columnValue: string;
  /** Whether card is selected */
  isSelected: boolean;
  /** Whether card is focused */
  isFocused: boolean;
  /** Whether card is being dragged */
  isDragging: boolean;
  /** Whether card is being edited */
  isEditing: boolean;
  /** Column infos for field rendering */
  columnInfos?: ColumnInfo[];
  /** Click handler */
  onClick: (cardId: string, event: React.MouseEvent) => void;
  /** Double-click handler */
  onDoubleClick: (cardId: string) => void;
  /** Drag start handler */
  onDragStart: (event: React.DragEvent, cardId: string, columnValue: string) => void;
  /** Drag end handler */
  onDragEnd: (event: React.DragEvent) => void;
}

/**
 * Props for AddCardButton component.
 */
export interface AddCardButtonProps {
  /** Column value */
  columnValue: string;
  /** Whether currently adding in this column */
  isAdding: boolean;
  /** Start add handler */
  onStartAdd: (columnValue: string) => void;
  /** Commit add handler */
  onCommitAdd: (columnValue: string, title: string) => void;
  /** Cancel add handler */
  onCancelAdd: () => void;
}
