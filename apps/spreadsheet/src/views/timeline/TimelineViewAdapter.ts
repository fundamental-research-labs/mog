/**
 * TimelineViewAdapter
 *
 * Implements the ViewAdapter interface for the Timeline view.
 * Bridges the Timeline view to the Shell's view coordination system.
 *
 * Responsibilities:
 * - Selection management
 * - Clipboard operations (copy/paste bars as records)
 * - Toolbar context (view capabilities)
 * - Lifecycle management (mount/unmount/dispose)
 * - Date persistence (coordinator pattern with transition detection)
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import { toRowId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import { KeyboardEventProcessor } from '@mog-sdk/kernel/keyboard';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createActor } from 'xstate';
import type { ClipboardPayload, ColumnSchema, ColumnTypeKind } from '../../domain/clipboard/types';
import {
  clipboardCellValueToText,
  fromClipboardCellValue,
  toClipboardCellValue,
} from '../../domain/clipboard/cell-value-contract';
import type {
  TableId,
  TimelineViewConfig,
  ToolbarContext,
  ViewAdapter,
  ViewAdapterConfig,
  ViewId,
  ViewSelection,
} from '../types';
import {
  TimelineEvents,
  timelineMachine,
  type TimelineActor,
  type TimelineState,
} from './machines';
import { detectPlatform } from '../../utils/platform';
import { TimelineView } from './TimelineView';

/**
 * Adapter for Timeline view that implements ViewAdapter interface.
 */
export class TimelineViewAdapter implements ViewAdapter {
  readonly viewId: ViewId;
  readonly viewType = 'timeline' as const;

  private actor: TimelineActor;
  private root: Root | null = null;
  private timelineConfig: TimelineViewConfig;
  private tableId: TableId | undefined;
  private workbook: Workbook;

  private processor = new KeyboardEventProcessor(detectPlatform());
  private selectionListeners = new Set<(selection: ViewSelection) => void>();
  private toolbarListeners = new Set<(ctx: ToolbarContext) => void>();

  // For transition detection pattern (per ARCHITECTURE-CHECKLIST.md Section 4)
  private previousState: TimelineState | null = null;

  constructor(config: ViewAdapterConfig<'timeline'>) {
    this.viewId = config.viewId;
    this.tableId = config.tableId;
    this.timelineConfig = config.config as TimelineViewConfig;
    this.workbook = config.workbook;

    // Create state machine actor
    this.actor = createActor(timelineMachine);
    this.actor.start();

    // Subscribe to state changes with transition detection
    this.actor.subscribe((state) => {
      this.handleStateTransition(state);
      this.notifySelectionChange(state);
      this.notifyToolbarChange();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Coordinator Pattern: Transition Detection
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handles state transitions with the coordinator pattern.
   * Detects when drag/resize operations end and persists the new dates.
   */
  private handleStateTransition(state: TimelineState): void {
    const wasInteraction = this.previousState?.context.interaction;
    const isInteraction = state.context.interaction;

    // Detect transition FROM dragging-bar TO idle
    if (wasInteraction?.type === 'dragging-bar' && isInteraction.type === 'idle') {
      const { barId, offsetDays } = wasInteraction;
      void this.persistDragResult(barId, offsetDays);
    }

    // Detect transition FROM resizing-bar TO idle
    if (wasInteraction?.type === 'resizing-bar' && isInteraction.type === 'idle') {
      const { barId, edge, offsetDays } = wasInteraction;
      void this.persistResizeResult(barId, edge, offsetDays);
    }

    this.previousState = state;
  }

  /**
   * Persist the result of a drag operation to the database.
   * Calculates new start/end dates based on the offset and updates via Kernel API.
   */
  private async persistDragResult(barId: RowId, offsetDays: number): Promise<void> {
    if (!this.tableId || offsetDays === 0) return;

    // Get current record dates and calculate new dates
    const record = await this.workbook.records.get(this.tableId, barId);
    if (!record) return;

    const currentStartValue = record.values[this.timelineConfig.startDateColumn];
    const currentEndValue = this.timelineConfig.endDateColumn
      ? record.values[this.timelineConfig.endDateColumn]
      : null;

    // Parse dates from record values
    const currentStart = currentStartValue ? new Date(String(currentStartValue)) : new Date();
    const currentEnd = currentEndValue ? new Date(String(currentEndValue)) : new Date();

    const newStartDate = new Date(currentStart);
    newStartDate.setDate(newStartDate.getDate() + offsetDays);

    const newEndDate = new Date(currentEnd);
    newEndDate.setDate(newEndDate.getDate() + offsetDays);

    // Persist via Workbook Records API
    const changes: Record<ColId, CellValue> = {
      [this.timelineConfig.startDateColumn]: newStartDate.toISOString(),
    };
    if (this.timelineConfig.endDateColumn) {
      changes[this.timelineConfig.endDateColumn] = newEndDate.toISOString();
    }
    void this.workbook.records.update(this.tableId, barId, changes);
  }

  /**
   * Persist the result of a resize operation to the database.
   * Calculates the new date for the affected edge and updates via Kernel API.
   */
  private async persistResizeResult(
    barId: RowId,
    edge: 'start' | 'end',
    offsetDays: number,
  ): Promise<void> {
    if (!this.tableId || offsetDays === 0) return;

    // Determine which column to update
    const field =
      edge === 'start' ? this.timelineConfig.startDateColumn : this.timelineConfig.endDateColumn;

    if (!field) return;

    // Get current date for the edge being resized
    const record = await this.workbook.records.get(this.tableId, barId);
    if (!record) return;

    const currentDateValue = record.values[field];
    const currentDate = currentDateValue ? new Date(String(currentDateValue)) : new Date();

    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + offsetDays);

    // Persist via Workbook Records API
    void this.workbook.records.update(this.tableId, barId, { [field]: newDate.toISOString() });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Selection Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getSelection(): ViewSelection {
    const state = this.actor.getSnapshot();
    return {
      type: 'timeline',
      data: {
        barIds: Array.from(state.context.selectedBars),
        focusedBar: state.context.focusedBar,
      },
    };
  }

  clearSelection(): void {
    this.actor.send(TimelineEvents.clearSelection());
  }

  selectAll(): void {
    // This would need access to all row IDs from the data
    // For now, send a select all event that the view will handle
    this.actor.send(TimelineEvents.selectAll());
  }

  onSelectionChange(listener: (selection: ViewSelection) => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  private notifySelectionChange(_state: TimelineState): void {
    const selection = this.getSelection();
    this.selectionListeners.forEach((listener) => listener(selection));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Clipboard Contract (uses canonical ClipboardPayload format)
  // ═══════════════════════════════════════════════════════════════════════════

  async getClipboardPayload(): Promise<ClipboardPayload> {
    const state = this.actor.getSnapshot();
    const selectedBars = Array.from(state.context.selectedBars);
    const rowIds = selectedBars.map(toRowId);

    // Build column IDs for timeline data
    const colIds: ColId[] = [this.timelineConfig.titleColumn, this.timelineConfig.startDateColumn];

    if (this.timelineConfig.endDateColumn) {
      colIds.push(this.timelineConfig.endDateColumn);
    }

    // Build 2D cell values (one row per bar)
    const cellValues: CellValue[][] = [];
    for (const rowId of rowIds) {
      const record = await this.workbook.records.get(this.tableId!, rowId);
      cellValues.push(colIds.map((colId) => toClipboardCellValue(record?.values[colId] ?? null)));
    }

    // Build column schemas
    const columnSchemas: ColumnSchema[] = [
      { id: this.timelineConfig.titleColumn, name: 'Title', kind: 'text' },
      { id: this.timelineConfig.startDateColumn, name: 'Start Date', kind: 'date' },
    ];
    if (this.timelineConfig.endDateColumn) {
      columnSchemas.push({ id: this.timelineConfig.endDateColumn, name: 'End Date', kind: 'date' });
    }

    // Build text representation
    const text = await this.buildTextRepresentation(rowIds);

    return {
      cells: {
        values: cellValues,
        rowCount: rowIds.length,
        colCount: colIds.length,
      },
      tableContext: this.tableId
        ? {
            tableId: this.tableId,
            rowIds,
            colIds,
            columnSchemas,
          }
        : undefined,
      source: {
        viewType: 'timeline',
        viewId: this.viewId,
        sheetId: this.timelineConfig.sheetId,
      },
      text,
    };
  }

  canPaste(payload: ClipboardPayload): boolean {
    // Timeline can paste:
    // - Cells with data
    // - Text that can be parsed as dates
    return (payload.cells && payload.cells.rowCount > 0) || payload.text !== '';
  }

  async paste(payload: ClipboardPayload): Promise<void> {
    if (!this.tableId) return;

    // Prefer cells format with tableContext
    if (payload.cells && payload.cells.values.length > 0) {
      const colIds = payload.tableContext?.colIds ?? [
        this.timelineConfig.titleColumn,
        this.timelineConfig.startDateColumn,
      ];

      for (let r = 0; r < payload.cells.values.length; r++) {
        const row = payload.cells.values[r];
        const values: Record<ColId, CellValue> = {};
        for (let c = 0; c < row.length && c < colIds.length; c++) {
          const columnKind =
            payload.tableContext?.columnSchemas[c]?.kind ?? this.getClipboardColumnType(colIds[c]);
          values[colIds[c]] = fromClipboardCellValue(row[c], columnKind);
        }
        void this.workbook.records.create(this.tableId, values);
      }
    } else if (payload.text) {
      await this.pasteText(payload.text);
    }
  }

  private async pasteText(text: string): Promise<void> {
    // Parse text and create records
    const lines = text.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const parts = line.split('\t');
      const title = parts[0] || '';
      const startDateStr = parts[1];
      const endDateStr = parts[2];

      const values: Record<ColId, CellValue> = {
        [this.timelineConfig.titleColumn]: title,
      };

      // Parse start date if present
      if (startDateStr) {
        const startDate = new Date(startDateStr);
        if (!isNaN(startDate.getTime())) {
          values[this.timelineConfig.startDateColumn] = fromClipboardCellValue(startDate, 'date');
        }
      }

      // Parse end date if present
      if (endDateStr && this.timelineConfig.endDateColumn) {
        const endDate = new Date(endDateStr);
        if (!isNaN(endDate.getTime())) {
          values[this.timelineConfig.endDateColumn] = fromClipboardCellValue(endDate, 'date');
        }
      }

      void this.workbook.records.create(this.tableId!, values);
    }
  }

  private async buildTextRepresentation(rowIds: RowId[]): Promise<string> {
    // Build TSV representation
    // Header row
    const header = ['Title', 'Start Date', this.timelineConfig.endDateColumn ? 'End Date' : null]
      .filter(Boolean)
      .join('\t');

    // Build data rows from records
    const dataRows: string[] = [];
    for (const rowId of rowIds) {
      const record = await this.workbook.records.get(this.tableId!, rowId);
      const title = record?.values[this.timelineConfig.titleColumn] ?? '';
      const startDate = record?.values[this.timelineConfig.startDateColumn] ?? '';
      const endDate = this.timelineConfig.endDateColumn
        ? (record?.values[this.timelineConfig.endDateColumn] ?? '')
        : null;
      dataRows.push(
        [title, startDate, endDate]
          .filter((v) => v !== null)
          .map((value) => clipboardCellValueToText(toClipboardCellValue(value ?? null)))
          .join('\t'),
      );
    }

    return [header, ...dataRows].join('\n');
  }

  private getClipboardColumnType(colId: ColId): ColumnTypeKind | undefined {
    if (
      colId === this.timelineConfig.startDateColumn ||
      colId === this.timelineConfig.endDateColumn
    ) {
      return 'date';
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Edit Contract
  // ═══════════════════════════════════════════════════════════════════════════

  isEditing(): boolean {
    // Timeline doesn't have inline editing like Grid
    // Could be extended to support editing bar labels
    return false;
  }

  startEdit(_target: unknown): void {
    // Not implemented for Timeline
    // Could open a record detail panel
  }

  async commitEdit(): Promise<void> {
    // Not applicable
  }

  cancelEdit(): void {
    // Not applicable
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getToolbarContext(): ToolbarContext {
    const state = this.actor.getSnapshot();
    const selectedCount = state.context.selectedBars.size;

    return {
      formatting: {
        // Timeline bars don't support direct text formatting
        canBold: false,
        canItalic: false,
        canUnderline: false,
        canChangeFont: false,
        canChangeFontSize: false,
        canChangeColor: true, // Can change bar color
        canChangeFillColor: true,
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
        fillColor: null, // Could show bar color
        horizontalAlign: null,
        verticalAlign: null,
      },
      structure: {
        canInsertRow: true, // Add new task/bar
        canDeleteRow: selectedCount > 0,
        canInsertColumn: false,
        canDeleteColumn: false,
        canMerge: false,
        canUnmerge: false,
        canSort: true, // Sort by date, etc.
        canFilter: true,
      },
      selection: {
        hasSelection: selectedCount > 0,
        selectionCount: selectedCount,
        selectionLabel: this.getSelectionLabel(selectedCount),
      },
    };
  }

  onToolbarContextChange(listener: (ctx: ToolbarContext) => void): () => void {
    this.toolbarListeners.add(listener);
    return () => this.toolbarListeners.delete(listener);
  }

  private notifyToolbarChange(): void {
    const ctx = this.getToolbarContext();
    this.toolbarListeners.forEach((listener) => listener(ctx));
  }

  private getSelectionLabel(count: number): string {
    if (count === 0) return '';
    if (count === 1) {
      const state = this.actor.getSnapshot();
      const focusedBar = state.context.focusedBar;
      if (focusedBar) {
        // TODO: Get bar title from data
        return String(focusedBar);
      }
      return '1 task';
    }
    return `${count} tasks`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard Contract
  // ═══════════════════════════════════════════════════════════════════════════

  handleKeyboard(event: KeyboardEvent): boolean {
    const input = this.processor.process(event);
    if (input.isComposing) return false;

    const modifiers = {
      shiftKey: input.modifiers.shift,
      ctrlKey: input.modifiers.ctrl,
      metaKey: input.modifiers.meta,
      altKey: input.modifiers.alt,
    };

    this.actor.send(TimelineEvents.keyboard(input.character, modifiers));

    // Handle specific keys
    switch (input.character) {
      case 'Escape':
        this.actor.send(TimelineEvents.cancel());
        return true;

      case 'Delete':
      case 'Backspace':
        if (this.actor.getSnapshot().context.selectedBars.size > 0) {
          // Delete selected records via Kernel
          const selectedBars = Array.from(this.actor.getSnapshot().context.selectedBars).map(
            toRowId,
          );
          for (const barId of selectedBars) {
            void this.workbook.records.remove(this.tableId!, barId);
          }
          this.clearSelection();
          return true;
        }
        break;

      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        // TODO: Navigate between bars
        return true;

      case 'a':
        if (input.modifiers.ctrl || input.modifiers.meta) {
          this.selectAll();
          return true;
        }
        break;

      case 'c':
        if (input.modifiers.ctrl || input.modifiers.meta) {
          // Copy handled by Shell
          return false;
        }
        break;

      case 'v':
        if (input.modifiers.ctrl || input.modifiers.meta) {
          // Paste handled by Shell
          return false;
        }
        break;

      case '+':
      case '=':
        if (input.modifiers.ctrl || input.modifiers.meta) {
          this.actor.send(TimelineEvents.zoom('in'));
          return true;
        }
        break;

      case '-':
        if (input.modifiers.ctrl || input.modifiers.meta) {
          this.actor.send(TimelineEvents.zoom('out'));
          return true;
        }
        break;
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Formatting Contract
  // ═══════════════════════════════════════════════════════════════════════════

  applyFormatting(format: Partial<CellFormat>): void {
    // Timeline could apply color to bars
    if (format.backgroundColor) {
      // TODO: Update bar colors for selected bars
    }
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
    // Full cleanup
    this.unmount();
    this.actor.stop();
    this.selectionListeners.clear();
    this.toolbarListeners.clear();
    this.previousState = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  private render(): void {
    if (!this.root) return;

    this.root.render(
      React.createElement(TimelineView, {
        actor: this.actor,
        workbook: this.workbook,
        config: this.timelineConfig,
        onBarDoubleClick: this.handleBarDoubleClick.bind(this),
        onDatesChange: this.handleDatesChange.bind(this),
      }),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Mutation Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  private handleBarDoubleClick(_rowId: RowId): void {
    // Could open a record detail panel
    // This would typically open a detail view/dialog for the record
    // The actual implementation depends on the shell's UI system
  }

  private handleDatesChange(rowId: RowId, startDate: Date, endDate: Date): void {
    // This is called from the view if it wants to directly update dates
    if (!this.tableId) return;

    const values: Record<ColId, CellValue> = {
      [this.timelineConfig.startDateColumn]: startDate.toISOString(),
    };

    if (this.timelineConfig.endDateColumn) {
      values[this.timelineConfig.endDateColumn] = endDate.toISOString();
    }

    void this.workbook.records.update(this.tableId, rowId, values);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Timeline-specific methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the state machine actor for direct access if needed.
   */
  getActor(): TimelineActor {
    return this.actor;
  }

  /**
   * Scroll to a specific date.
   */
  scrollToDate(date: Date, _alignment?: 'start' | 'center' | 'end'): void {
    this.actor.send(TimelineEvents.setViewportStart(date));
  }

  /**
   * Set the time scale.
   */
  setScale(scale: 'day' | 'week' | 'month' | 'quarter' | 'year'): void {
    this.actor.send(TimelineEvents.setScale(scale));
  }

  /**
   * Zoom in or out.
   */
  zoom(direction: 'in' | 'out'): void {
    this.actor.send(TimelineEvents.zoom(direction));
  }

  /**
   * Toggle a group's collapsed state.
   */
  toggleGroup(groupKey: string): void {
    this.actor.send(TimelineEvents.toggleGroup(groupKey));
  }

  /**
   * Collapse all groups.
   */
  collapseAllGroups(): void {
    this.actor.send(TimelineEvents.collapseAllGroups());
  }

  /**
   * Expand all groups.
   */
  expandAllGroups(): void {
    this.actor.send(TimelineEvents.expandAllGroups());
  }
}
