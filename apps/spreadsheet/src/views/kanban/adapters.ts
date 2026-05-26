/**
 * Kanban Adapter Utilities
 *
 * Thin adapter layer that converts between shell's kernel-coupled types (RowId, ColId)
 * and the kernel-agnostic UI component types (plain string IDs).
 *
 * This enables shell to use the @mog/ui KanbanBoard component while maintaining
 * its own state machines and data fetching via kernel hooks.
 *
 */

import {
  toColId as canonicalToColId,
  toRowId as canonicalToRowId,
  type ColId,
  type RowId,
} from '@mog-sdk/contracts/cell-identity';
import type { ColumnInfo } from '@mog/ui';
import type {
  KanbanCardData as UIKanbanCard,
  KanbanColumnData as UIKanbanColumn,
  KanbanState as UIKanbanState,
} from '@mog/ui/data-views/kanban';
import type { KanbanSnapshot } from './machines';
import type {
  KanbanCard as ShellKanbanCard,
  KanbanColumn as ShellKanbanColumn,
} from './utils/card-grouping';

// =============================================================================
// Type Adapters: Shell (kernel types) -> UI (plain strings)
// =============================================================================

/**
 * Convert a shell Kanban card (with RowId) to a UI Kanban card (with string id).
 */
function adaptCard(card: ShellKanbanCard): UIKanbanCard {
  // Convert Map<ColId, CellValue> to Map<string, CellValueOrError>
  const fields = new Map<string, unknown>();
  for (const [colId, value] of card.fields) {
    fields.set(colId as string, value);
  }

  return {
    id: card.rowId as string,
    title: card.title,
    groupValue: card.groupValue,
    fields: fields as UIKanbanCard['fields'],
    color: card.color,
  };
}

/**
 * Convert a shell Kanban column to a UI Kanban column.
 */
function adaptColumn(column: ShellKanbanColumn): UIKanbanColumn {
  return {
    value: column.value,
    label: column.label,
    color: column.color,
    cards: column.cards.map(adaptCard),
    isCollapsed: column.isCollapsed,
    wipLimit: column.wipLimit,
    isOverLimit: column.isOverLimit,
  };
}

/**
 * Convert shell Kanban columns to UI Kanban columns.
 *
 * This is the main adapter function for data.
 *
 * @param columns - Shell columns with RowId-typed cards
 * @returns UI columns with string-typed cards
 */
export function adaptColumnsToUI(columns: ShellKanbanColumn[]): UIKanbanColumn[] {
  return columns.map(adaptColumn);
}

/**
 * Convert shell KanbanSnapshot to UI KanbanState.
 *
 * The shell maintains interaction state (selection, drag, etc.) in its state machine.
 * This converts that snapshot to the UI component's expected state shape.
 *
 * @param snapshot - Shell state machine snapshot
 * @returns UI component state
 */
export function adaptSnapshotToUIState(snapshot: KanbanSnapshot): UIKanbanState {
  return {
    mode: snapshot.state,
    selectedCardIds: snapshot.selectedCards.map((id) => id as string),
    focusedCardId: snapshot.focusedCard ? (snapshot.focusedCard as string) : null,
    draggedCardId: snapshot.draggedCard ? (snapshot.draggedCard as string) : null,
    draggedOverColumn: snapshot.draggedOverColumn,
    dropPosition: snapshot.dropPosition,
    editingCardId: snapshot.editingCard ? (snapshot.editingCard as string) : null,
    addingInColumn: snapshot.addingInColumn,
  };
}

/**
 * Convert shell column schemas to UI ColumnInfo array.
 *
 * @param schemas - Map of ColId to schema info
 * @returns Array of ColumnInfo for the UI component
 */
export function adaptColumnSchemasToUI(
  schemas: Map<ColId, { name: string; type: string }> | undefined,
): ColumnInfo[] | undefined {
  if (!schemas) return undefined;

  const result: ColumnInfo[] = [];
  let index = 0;

  for (const [colId, schema] of schemas) {
    result.push({
      id: colId as string,
      name: schema.name,
      type: mapSchemaTypeToColumnTypeKind(schema.type),
      index: index++,
    });
  }

  return result;
}

/**
 * Map kernel schema types to UI ColumnTypeKind.
 */
function mapSchemaTypeToColumnTypeKind(type: string): ColumnInfo['type'] {
  // Map common schema types to UI column type kinds
  const typeMap: Record<string, ColumnInfo['type']> = {
    text: 'text',
    string: 'text',
    number: 'number',
    integer: 'number',
    float: 'number',
    date: 'date',
    datetime: 'date',
    boolean: 'checkbox',
    checkbox: 'checkbox',
    select: 'select',
    multiselect: 'multiselect',
    person: 'person',
    file: 'file',
    url: 'url',
    email: 'email',
    phone: 'phone',
    rating: 'rating',
    progress: 'progress',
    formula: 'formula',
    createdTime: 'createdTime',
    modifiedTime: 'modifiedTime',
    autoNumber: 'autoNumber',
    relation: 'relation',
    lookup: 'lookup',
    rollup: 'rollup',
  };

  return typeMap[type.toLowerCase()] || 'text';
}

// =============================================================================
// ID Converters: UI (plain strings) -> Shell (kernel types)
// =============================================================================

/**
 * Convert a UI card ID (string) back to a shell RowId.
 * Used in event handlers when the UI component reports interactions.
 */
export function toRowId(cardId: string): RowId {
  return canonicalToRowId(cardId);
}

/**
 * Convert a UI column ID (string) back to a shell ColId.
 * Used when referencing columns in event handlers.
 */
export function toColId(columnId: string): ColId {
  return canonicalToColId(columnId);
}
