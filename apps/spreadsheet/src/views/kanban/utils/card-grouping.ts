/**
 * Card Grouping Utilities
 *
 * Functions for grouping records by a select column value.
 * Used by the Kanban view to organize cards into columns.
 */

import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';

/**
 * A record represented as a card in Kanban view.
 */
export interface KanbanCard {
  /** Row ID (unique identifier) */
  rowId: RowId;
  /** Title of the card (from cardTitleColumn) */
  title: string;
  /** Group value (from groupByColumn) */
  groupValue: string;
  /** Field values to display on card */
  fields: Map<ColId, CellValue>;
  /** Optional color for the card */
  color?: string;
}

/**
 * A column in the Kanban board.
 */
export interface KanbanColumn {
  /** Column value (from select options) */
  value: string;
  /** Display label */
  label: string;
  /** Color of the column header (from select option) */
  color?: string;
  /** Cards in this column */
  cards: KanbanCard[];
  /** Whether column is collapsed */
  isCollapsed: boolean;
  /** WIP limit (if set) */
  wipLimit?: number;
  /** Whether WIP limit is exceeded */
  isOverLimit: boolean;
}

/**
 * Select option definition.
 */
export interface KanbanSelectOption {
  value: string;
  label: string;
  color?: string;
}

/**
 * Input for grouping records.
 */
export interface GroupRecordsInput {
  /** All records from the table */
  records: Array<{
    rowId: RowId;
    values: Map<ColId, CellValue>;
  }>;
  /** Column ID to group by */
  groupByColumn: ColId;
  /** Column ID for card title */
  cardTitleColumn: ColId;
  /** Column IDs to show as fields on cards */
  cardFields: ColId[];
  /** Optional column for card color */
  cardColorColumn?: ColId;
  /** Available options for the select column */
  selectOptions: KanbanSelectOption[];
  /** Whether to show columns with no cards */
  showEmptyGroups: boolean;
  /** Custom column order (overrides option order) */
  columnOrder?: string[];
  /** WIP limits per column */
  wipLimits?: Record<string, number>;
  /** Collapsed columns */
  collapsedColumns?: string[];
}

/**
 * Group records into Kanban columns by a select column value.
 *
 * @param input - Grouping configuration and data
 * @returns Array of Kanban columns with their cards
 */
export function groupRecordsByColumn(input: GroupRecordsInput): KanbanColumn[] {
  const {
    records,
    groupByColumn,
    cardTitleColumn,
    cardFields,
    cardColorColumn,
    selectOptions,
    showEmptyGroups,
    columnOrder,
    wipLimits = {},
    collapsedColumns = [],
  } = input;

  // Create map of option value -> option for quick lookup
  const optionMap = new Map<string, KanbanSelectOption>();
  for (const option of selectOptions) {
    optionMap.set(option.value, option);
  }

  // Group records by their group column value
  const groupedRecords = new Map<string, KanbanCard[]>();

  for (const record of records) {
    const groupValue = record.values.get(groupByColumn);
    const groupKey = groupValue != null ? String(groupValue) : '';

    // Get or create the group
    if (!groupedRecords.has(groupKey)) {
      groupedRecords.set(groupKey, []);
    }

    // Create card from record
    const titleValue = record.values.get(cardTitleColumn);
    const title = titleValue != null ? String(titleValue) : '';

    const fields = new Map<ColId, CellValue>();
    for (const fieldId of cardFields) {
      const value = record.values.get(fieldId);
      if (value !== undefined) {
        fields.set(fieldId, value);
      }
    }

    let color: string | undefined;
    if (cardColorColumn) {
      const colorValue = record.values.get(cardColorColumn);
      if (colorValue != null) {
        color = String(colorValue);
      }
    }

    const card: KanbanCard = {
      rowId: record.rowId,
      title,
      groupValue: groupKey,
      fields,
      color,
    };

    groupedRecords.get(groupKey)!.push(card);
  }

  // Determine column order
  let orderedValues: string[];
  if (columnOrder && columnOrder.length > 0) {
    // Use custom order, but include any values not in the order
    const orderSet = new Set(columnOrder);
    const extraValues = Array.from(groupedRecords.keys()).filter((v) => !orderSet.has(v));
    orderedValues = [...columnOrder, ...extraValues];
  } else {
    // Use option order from select column
    orderedValues = selectOptions.map((o) => o.value);
    // Add any values not in options (e.g., empty string, unknown values)
    const optionSet = new Set(orderedValues);
    for (const key of groupedRecords.keys()) {
      if (!optionSet.has(key)) {
        orderedValues.push(key);
      }
    }
  }

  // Build columns
  const columns: KanbanColumn[] = [];
  const collapsedSet = new Set(collapsedColumns);

  for (const value of orderedValues) {
    const cards = groupedRecords.get(value) || [];

    // Skip empty columns if showEmptyGroups is false
    if (!showEmptyGroups && cards.length === 0) {
      continue;
    }

    const option = optionMap.get(value);
    const wipLimit = wipLimits[value];
    const isOverLimit = wipLimit !== undefined && cards.length > wipLimit;

    columns.push({
      value,
      label: option?.label || value || '(No status)',
      color: option?.color,
      cards,
      isCollapsed: collapsedSet.has(value),
      wipLimit,
      isOverLimit,
    });
  }

  return columns;
}

/**
 * Find the column containing a specific card.
 */
export function findCardColumn(columns: KanbanColumn[], cardId: RowId): KanbanColumn | undefined {
  return columns.find((col) => col.cards.some((card) => card.rowId === cardId));
}

/**
 * Find a card by its row ID across all columns.
 */
export function findCard(columns: KanbanColumn[], cardId: RowId): KanbanCard | undefined {
  for (const col of columns) {
    const card = col.cards.find((c) => c.rowId === cardId);
    if (card) return card;
  }
  return undefined;
}

/**
 * Get all card IDs from all columns in order.
 */
export function getAllCardIds(columns: KanbanColumn[]): RowId[] {
  return columns.flatMap((col) => col.cards.map((card) => card.rowId));
}

/**
 * Get the next card ID for keyboard navigation.
 */
export function getNextCardId(
  columns: KanbanColumn[],
  currentCardId: RowId,
  direction: 'up' | 'down' | 'left' | 'right',
): RowId | null {
  // Find current card position
  let colIndex = -1;
  let cardIndex = -1;

  for (let c = 0; c < columns.length; c++) {
    const column = columns[c];
    for (let r = 0; r < column.cards.length; r++) {
      if (column.cards[r].rowId === currentCardId) {
        colIndex = c;
        cardIndex = r;
        break;
      }
    }
    if (colIndex >= 0) break;
  }

  if (colIndex < 0 || cardIndex < 0) return null;

  switch (direction) {
    case 'up': {
      // Move up within column
      if (cardIndex > 0) {
        return columns[colIndex].cards[cardIndex - 1].rowId;
      }
      return null;
    }
    case 'down': {
      // Move down within column
      if (cardIndex < columns[colIndex].cards.length - 1) {
        return columns[colIndex].cards[cardIndex + 1].rowId;
      }
      return null;
    }
    case 'left': {
      // Move to previous column at same position
      if (colIndex > 0) {
        const prevColumn = columns[colIndex - 1];
        const targetIndex = Math.min(cardIndex, prevColumn.cards.length - 1);
        if (targetIndex >= 0) {
          return prevColumn.cards[targetIndex].rowId;
        }
      }
      return null;
    }
    case 'right': {
      // Move to next column at same position
      if (colIndex < columns.length - 1) {
        const nextColumn = columns[colIndex + 1];
        const targetIndex = Math.min(cardIndex, nextColumn.cards.length - 1);
        if (targetIndex >= 0) {
          return nextColumn.cards[targetIndex].rowId;
        }
      }
      return null;
    }
    default:
      return null;
  }
}
