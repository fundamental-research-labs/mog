/**
 * KanbanViewAdapter
 *
 * Implements the ViewAdapter interface for Kanban view.
 * Bridges the coordinator, data layer, and React rendering.
 *
 * Key responsibilities:
 * - Implement all ViewAdapter contracts (selection, clipboard, edit, toolbar)
 * - Delegate machine ownership to KanbanCoordinator
 * - Handle data mutations through Coordinator (which uses Workbook Records API)
 *
 * Architecture:
 * - Adapter: Implements ViewAdapter interface, handles lifecycle
 * - Coordinator: Owns the state machine, handles transition-based side effects
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import { toColId, toRowId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ClipboardPayload, ColumnSchema } from '../../domain/clipboard/types';
import {
  clipboardCellValueToText,
  fromClipboardCellValue,
  toClipboardCellValue,
} from '../../domain/clipboard/cell-value-contract';
import type {
  EditTarget,
  TableId,
  ToolbarContext,
  Unsubscribe,
  ViewAdapter,
  ViewId,
  ViewSelection,
} from '../types';
import type { KanbanViewConfig } from './config';
import { KanbanCoordinator } from './coordinator';
import { KanbanView } from './KanbanView';
import { getKanbanSnapshot, KanbanEvents, type KanbanActor } from './machines';

/**
 * Configuration for creating a KanbanViewAdapter.
 */
export interface KanbanViewAdapterConfig {
  viewId: ViewId;
  tableId: TableId;
  config: KanbanViewConfig;
  workbook: Workbook;
}

function isKanbanEditTarget(target: EditTarget): target is { cardId: string; fieldId?: string } {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as { cardId?: unknown; fieldId?: unknown };
  return (
    typeof candidate.cardId === 'string' &&
    (candidate.fieldId === undefined || typeof candidate.fieldId === 'string')
  );
}

/**
 * KanbanViewAdapter implements ViewAdapter for Kanban view.
 */
export class KanbanViewAdapter implements ViewAdapter {
  readonly viewId: ViewId;
  readonly viewType = 'kanban' as const;

  private tableId: TableId;
  private config: KanbanViewConfig;
  private workbook: Workbook;
  private root: Root | null = null;

  // Coordinator owns the state machine
  private coordinator: KanbanCoordinator;
  private actor: KanbanActor;

  private selectionListeners = new Set<(selection: ViewSelection) => void>();
  private toolbarListeners = new Set<(ctx: ToolbarContext) => void>();

  constructor(adapterConfig: KanbanViewAdapterConfig) {
    this.viewId = adapterConfig.viewId;
    this.tableId = adapterConfig.tableId;
    this.config = adapterConfig.config;
    this.workbook = adapterConfig.workbook;

    // Create coordinator which owns the state machine
    this.coordinator = new KanbanCoordinator({
      workbook: this.workbook,
      tableId: this.tableId,
      config: this.config,
    });

    // Get actor reference from coordinator
    this.actor = this.coordinator.getActor();

    // Subscribe to state changes to notify listeners
    this.actor.subscribe(() => {
      const selection = this.getSelection();
      this.selectionListeners.forEach((l) => l(selection));
      this.toolbarListeners.forEach((l) => l(this.getToolbarContext()));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Selection Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getSelection(): ViewSelection {
    const snapshot = getKanbanSnapshot(this.actor.getSnapshot());
    return {
      type: 'kanban',
      data: {
        cardIds: snapshot.selectedCards,
        focusedCard: snapshot.focusedCard,
      },
    };
  }

  clearSelection(): void {
    this.actor.send(KanbanEvents.clearSelection());
  }

  selectAll(): void {
    // Fetch all card IDs using Workbook Records API and select them
    void this.workbook.records.query(this.tableId).then((records) => {
      const allCardIds = records.map((r) => toRowId(r.rowId));
      this.actor.send(KanbanEvents.selectAll(allCardIds));
    });
  }

  onSelectionChange(listener: (selection: ViewSelection) => void): Unsubscribe {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Clipboard Contract (uses canonical ClipboardPayload format)
  // ═══════════════════════════════════════════════════════════════════════════

  async getClipboardPayload(): Promise<ClipboardPayload> {
    const snapshot = getKanbanSnapshot(this.actor.getSnapshot());
    const rowIds = snapshot.selectedCards.map(toRowId);

    // Get visible column IDs
    const colIds = this.getVisibleColumnIds();

    // Build 2D cell values from records using Workbook Records API
    const cellValues: CellValue[][] = [];
    for (const rowId of rowIds) {
      const record = await this.workbook.records.get(this.tableId, rowId);
      if (!record) {
        cellValues.push(colIds.map(() => null as CellValue));
      } else {
        cellValues.push(colIds.map((colId) => toClipboardCellValue(record.values[colId] ?? null)));
      }
    }

    // Build column schemas from table configuration
    const columnSchemas: ColumnSchema[] = colIds.map((colId) => ({
      id: colId,
      name: this.getColumnName(colId),
      kind: 'text' as const,
    }));

    // Build text representation (TSV) using actual values
    const text = await this.buildTSV(rowIds, colIds);

    return {
      cells: {
        values: cellValues,
        rowCount: rowIds.length,
        colCount: colIds.length,
      },
      tableContext: {
        tableId: this.tableId,
        rowIds,
        colIds,
        columnSchemas,
      },
      source: {
        viewType: 'kanban',
        viewId: this.viewId,
        sheetId: this.config.sheetId,
      },
      text,
    };
  }

  canPaste(payload: ClipboardPayload): boolean {
    // Kanban can paste cells (creates new records) or text
    return (payload.cells && payload.cells.rowCount > 0) || payload.text !== '';
  }

  async paste(payload: ClipboardPayload): Promise<void> {
    // Determine target column (use dragged over column if available, or first group value)
    const snapshot = getKanbanSnapshot(this.actor.getSnapshot());
    const targetColumn = snapshot.draggedOverColumn ?? this.getFirstGroupValue();

    // Check if same table (can duplicate records)
    if (payload.tableContext && payload.tableContext.tableId === this.tableId) {
      // Same table: duplicate records by copying their values
      for (const rowId of payload.tableContext.rowIds) {
        const sourceRecord = await this.workbook.records.get(this.tableId, rowId);
        if (sourceRecord) {
          // Create a copy with the target group column
          const newValues = { ...sourceRecord.values };
          newValues[this.config.groupByColumn] = targetColumn;
          void this.workbook.records.create(this.tableId, newValues);
        }
      }
    } else if (payload.cells && payload.cells.values.length > 0) {
      // Create records from cell data
      const colIds = payload.tableContext?.colIds ?? this.getVisibleColumnIds();
      for (let r = 0; r < payload.cells.values.length; r++) {
        const row = payload.cells.values[r];
        const values: Record<ColId, CellValue> = {};
        for (let c = 0; c < row.length && c < colIds.length; c++) {
          values[colIds[c]] = fromClipboardCellValue(
            row[c],
            payload.tableContext?.columnSchemas[c]?.kind,
          );
        }
        // Set the group-by column to target
        values[this.config.groupByColumn] = targetColumn;
        // Create record using Workbook Records API
        void this.workbook.records.create(this.tableId, values);
      }
    } else if (payload.text) {
      // Parse TSV and create records
      this.pasteText(payload.text, targetColumn);
    }
  }

  private pasteText(text: string, targetColumn: string): void {
    const lines = text.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const cells = line.split('\t');
      // Assuming first cell is title
      const title = cells[0] || '';
      if (title) {
        // Create record using Workbook Records API
        void this.workbook.records.create(this.tableId, {
          [this.config.cardTitleColumn]: title,
          [this.config.groupByColumn]: targetColumn,
        });
      }
    }
  }

  private async buildTSV(rowIds: RowId[], colIds: ColId[]): Promise<string> {
    // Build TSV from actual record data using Workbook Records API
    // Header row with column names
    const header = colIds.map((colId) => this.getColumnName(colId)).join('\t');
    // Data rows from record values
    const dataRows: string[] = [];
    for (const rowId of rowIds) {
      const record = await this.workbook.records.get(this.tableId, rowId);
      if (!record) {
        dataRows.push(colIds.map(() => '').join('\t'));
      } else {
        dataRows.push(
          colIds
            .map((colId) => {
              const value = record.values[colId];
              return clipboardCellValueToText(toClipboardCellValue(value ?? null));
            })
            .join('\t'),
        );
      }
    }
    return [header, ...dataRows].join('\n');
  }

  private getVisibleColumnIds(): ColId[] {
    // Return title column + card fields
    return [this.config.cardTitleColumn, ...this.config.cardFields];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Edit Contract
  // ═══════════════════════════════════════════════════════════════════════════

  isEditing(): boolean {
    const snapshot = getKanbanSnapshot(this.actor.getSnapshot());
    return snapshot.editingCard !== null || snapshot.addingInColumn !== null;
  }

  startEdit(target: EditTarget): void {
    // Target should be { cardId: RowId, fieldId?: ColId }
    if (isKanbanEditTarget(target)) {
      const cardId = toRowId(target.cardId);
      const fieldId = target.fieldId ? toColId(target.fieldId) : this.config.cardTitleColumn;
      this.actor.send(KanbanEvents.startEdit(cardId, fieldId));
    }
  }

  async commitEdit(): Promise<void> {
    this.actor.send(KanbanEvents.commitEdit());
  }

  cancelEdit(): void {
    this.actor.send(KanbanEvents.cancelEdit());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getToolbarContext(): ToolbarContext {
    const snapshot = getKanbanSnapshot(this.actor.getSnapshot());
    const hasSelection = snapshot.selectedCards.length > 0;

    return {
      formatting: {
        // Kanban cards don't support text formatting
        canBold: false,
        canItalic: false,
        canUnderline: false,
        canChangeFont: false,
        canChangeFontSize: false,
        canChangeColor: false,
        canChangeFillColor: false,
        canChangeAlignment: false,
        canChangeBorders: false,
      },
      state: {
        isBold: null,
        isItalic: null,
        isUnderline: null,
        fontFamily: null,
        fontSize: null,
        textColor: null,
        fillColor: null,
        horizontalAlign: null,
        verticalAlign: null,
      },
      structure: {
        canInsertRow: true, // Add card
        canDeleteRow: hasSelection, // Delete selected cards
        canInsertColumn: false, // Can't add columns in Kanban
        canDeleteColumn: false,
        canMerge: false,
        canUnmerge: false,
        canSort: true, // Sort within columns
        canFilter: true,
      },
      selection: {
        hasSelection,
        selectionCount: snapshot.selectedCards.length,
        selectionLabel: hasSelection
          ? snapshot.selectedCards.length === 1
            ? this.getCardTitle(snapshot.selectedCards[0])
            : `${snapshot.selectedCards.length} cards`
          : '',
      },
    };
  }

  onToolbarContextChange(listener: (ctx: ToolbarContext) => void): Unsubscribe {
    this.toolbarListeners.add(listener);
    return () => this.toolbarListeners.delete(listener);
  }

  private getCardTitle(cardId: RowId): string {
    // Fire-and-forget async fetch; return placeholder synchronously
    // The toolbar context will be updated reactively when data changes
    return `Card ${cardId}`;
  }

  /**
   * Get the name of a column by its ID.
   */
  private getColumnName(colId: ColId): string {
    // For card title and fields, we use the colId as is
    // The table's column definition would have the actual name
    // For now, return the colId (which matches column name in most cases)
    return colId;
  }

  /**
   * Get the first group value (used as default target for paste).
   */
  private getFirstGroupValue(): string {
    // If we have a configured column order, use the first value
    if (this.config.columnOrder && this.config.columnOrder.length > 0) {
      return this.config.columnOrder[0];
    }
    // Otherwise, return empty string (the record will need to be assigned to a group)
    return '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard Contract
  // ═══════════════════════════════════════════════════════════════════════════

  handleKeyboard(event: KeyboardEvent): boolean {
    // Keyboard is handled by the KanbanBoard component
    // This is for external keyboard events
    const modifiers = {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
    };
    this.actor.send(KanbanEvents.keyboard(event.key, modifiers));
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Formatting Contract (not supported for Kanban)
  // ═══════════════════════════════════════════════════════════════════════════

  applyFormatting(_format: Partial<CellFormat>): void {
    // Kanban cards don't support cell formatting
    // This is a no-op by design - Kanban cards use their own styling
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  mount(container: HTMLElement): void {
    this.root = createRoot(container);
    this.render();
  }

  unmount(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  dispose(): void {
    this.unmount();
    this.coordinator.dispose();
    this.selectionListeners.clear();
    this.toolbarListeners.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  private render(): void {
    if (!this.root) return;

    this.root.render(
      React.createElement(KanbanView, {
        actor: this.actor,
        workbook: this.workbook,
        config: this.config,
        onCardMove: this.handleCardMove.bind(this),
        onCardEdit: this.handleCardEdit.bind(this),
        onCardCreate: this.handleCardCreate.bind(this),
        onCardsDelete: this.handleCardsDelete.bind(this),
      }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Mutation Handlers (delegated to Coordinator)
  // ═══════════════════════════════════════════════════════════════════════════

  private handleCardMove(cardId: RowId, newGroupValue: string, index: number): void {
    this.coordinator.handleCardMove(cardId, newGroupValue, index);
  }

  private handleCardEdit(cardId: RowId, fieldId: ColId | null, value: CellValue): void {
    this.coordinator.handleCardEdit(cardId, fieldId, value);
  }

  private handleCardCreate(groupValue: string, title: string): void {
    this.coordinator.handleCardCreate(groupValue, title);
  }

  private handleCardsDelete(cardIds: RowId[]): void {
    this.coordinator.handleCardsDelete(cardIds);
  }
}
