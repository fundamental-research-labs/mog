/**
 * KanbanView Component
 *
 * Thin adapter layer that renders the kernel-agnostic KanbanBoard from @mog/ui.
 * Connects shell's state machine and kernel data hooks to the UI component.
 *
 * Responsibilities:
 * 1. Fetch data via kernel hooks (useKanbanData)
 * 2. Maintain interaction state via XState machine
 * 3. Translate between kernel types (RowId, ColId) and UI types (string IDs)
 * 4. Wire event handlers to update state and trigger kernel mutations
 *
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import type { KeyModifiers as UIKeyModifiers } from '@mog/ui';
import { KanbanBoard as UIKanbanBoard } from '@mog/ui';
import { useSelector } from '@xstate/react';
import { useCallback, useMemo } from 'react';
import {
  adaptColumnSchemasToUI,
  adaptColumnsToUI,
  adaptSnapshotToUIState,
  toRowId,
} from './adapters';
import type { KanbanViewConfig } from './config';
import { useKanbanData } from './hooks/use-kanban-data';
import { getKanbanSnapshot, KanbanEvents, type KanbanActor, type KeyModifiers } from './machines';
import { getAllCardIds } from './utils/card-grouping';
export interface KanbanViewProps {
  /** The state machine actor (owned by the adapter) */
  actor: KanbanActor;
  /** Workbook API for data access */
  workbook: Workbook;
  /** Kanban view configuration */
  config: KanbanViewConfig;
  /** Callback when a card's group changes (drag and drop) */
  onCardMove: (cardId: RowId, newGroupValue: string, index: number) => void;
  /** Callback when a card field is edited */
  onCardEdit: (cardId: RowId, fieldId: ColId | null, value: CellValue) => void;
  /** Callback when a new card is created */
  onCardCreate: (groupValue: string, title: string) => void;
  /** Callback when cards are deleted */
  onCardsDelete: (cardIds: RowId[]) => void;
  /** Callback to get card title for a row */
  getCardTitle?: (rowId: RowId) => string;
  /** Column schemas for field rendering */
  columnSchemas?: Map<ColId, { name: string; type: string }>;
}

/**
 * KanbanView renders the Kanban board with columns and cards.
 *
 * This is a thin adapter that:
 * 1. Uses kernel hooks to fetch data
 * 2. Maintains interaction state via XState
 * 3. Adapts types for the UI component
 * 4. Wires events back to kernel mutations
 */
export function KanbanView({
  actor,
  workbook,
  config,
  onCardMove,
  onCardEdit: _onCardEdit,
  onCardCreate,
  onCardsDelete,
  getCardTitle: _getCardTitle,
  columnSchemas,
}: KanbanViewProps) {
  // =========================================================================
  // State Machine & Data
  // =========================================================================

  // Use the actor passed from the adapter (single source of truth)
  const snapshot = useSelector(actor, getKanbanSnapshot);
  const send = actor.send;

  // Get grouped data from kernel
  const shellColumns = useKanbanData(workbook, config);

  // =========================================================================
  // Type Adapters: Shell types -> UI types
  // =========================================================================

  // Adapt shell columns (with RowId) to UI columns (with string id)
  const uiColumns = useMemo(() => adaptColumnsToUI(shellColumns), [shellColumns]);

  // Adapt shell snapshot to UI state
  const uiState = useMemo(() => adaptSnapshotToUIState(snapshot), [snapshot]);

  // Adapt column schemas to UI ColumnInfo
  const uiColumnInfos = useMemo(() => adaptColumnSchemasToUI(columnSchemas), [columnSchemas]);

  // =========================================================================
  // Event Handlers: UI events -> Shell/Kernel actions
  // =========================================================================

  // Handle card click (UI string ID -> RowId)
  const handleCardClick = useCallback(
    (cardId: string, modifiers: UIKeyModifiers) => {
      send(KanbanEvents.cardClick(toRowId(cardId), modifiers as KeyModifiers));
    },
    [send],
  );

  // Handle card double-click
  const handleCardDoubleClick = useCallback(
    (cardId: string) => {
      send(KanbanEvents.cardDoubleClick(toRowId(cardId)));
    },
    [send],
  );

  // Handle clear selection
  const handleClearSelection = useCallback(() => {
    send(KanbanEvents.clearSelection());
  }, [send]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (key: string, modifiers: UIKeyModifiers) => {
      // Handle Escape
      if (key === 'Escape') {
        send(KanbanEvents.clearSelection());
        return;
      }

      // Handle Ctrl/Cmd+A
      if (key === 'a' && (modifiers.ctrlKey || modifiers.metaKey)) {
        const allCardIds = getAllCardIds(shellColumns);
        send(KanbanEvents.selectAll(allCardIds));
        return;
      }

      // Handle Delete
      if ((key === 'Delete' || key === 'Backspace') && snapshot.selectedCards.length > 0) {
        onCardsDelete(snapshot.selectedCards);
        return;
      }

      // General keyboard event
      send(KanbanEvents.keyboard(key, modifiers as KeyModifiers));
    },
    [send, shellColumns, snapshot.selectedCards, onCardsDelete],
  );

  // Handle card drop (from UI onDrop callback)
  const handleDrop = useCallback(
    (cardId: string, targetColumn: string, targetIndex: number) => {
      // Update data via kernel
      onCardMove(toRowId(cardId), targetColumn, targetIndex);
      // Update state machine
      send(KanbanEvents.drop());
    },
    [onCardMove, send],
  );

  // Handle start add card
  const handleStartAddCard = useCallback(
    (columnValue: string) => {
      send(KanbanEvents.startAddCard(columnValue));
    },
    [send],
  );

  // Handle commit add card
  const handleCommitAddCard = useCallback(
    (columnValue: string, title: string) => {
      onCardCreate(columnValue, title);
      send(KanbanEvents.commitAddCard());
    },
    [onCardCreate, send],
  );

  // Handle cancel add card
  const handleCancelAddCard = useCallback(() => {
    send(KanbanEvents.cancelAddCard());
  }, [send]);

  // Handle toggle column collapse
  const handleToggleCollapse = useCallback((_columnValue: string) => {
    // TODO: Update config.collapsedColumns via Kernel API when available
    // This would add/remove columnValue from the collapsed set
  }, []);

  // Handle focus card
  const handleFocusCard = useCallback(
    (cardId: string) => {
      send(KanbanEvents.focusCard(toRowId(cardId)));
    },
    [send],
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (cardId: string) => {
      send(KanbanEvents.dragStart(toRowId(cardId)));
    },
    [send],
  );

  // Handle drag over
  const handleDragOver = useCallback(
    (column: string, index: number) => {
      send(KanbanEvents.dragOver(column, index));
    },
    [send],
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    send(KanbanEvents.dragEnd());
  }, [send]);

  // =========================================================================
  // Render: Use UI component with adapted props
  // =========================================================================

  return (
    <div className="kanban-view flex flex-col h-full bg-ss-surface">
      <UIKanbanBoard
        columns={uiColumns}
        state={uiState}
        columnInfos={uiColumnInfos}
        onCardClick={handleCardClick}
        onCardDoubleClick={handleCardDoubleClick}
        onClearSelection={handleClearSelection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDrop={handleDrop}
        onStartAddCard={handleStartAddCard}
        onCommitAddCard={handleCommitAddCard}
        onCancelAddCard={handleCancelAddCard}
        onToggleCollapse={handleToggleCollapse}
        onFocusCard={handleFocusCard}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
