/**
 * CalendarViewAdapter
 *
 * Implements the ViewAdapter interface for Calendar view.
 * Bridges the state machine, data layer, and React rendering.
 *
 * Key responsibilities:
 * - Implement all ViewAdapter contracts (selection, clipboard, edit, toolbar)
 * - Manage state machine lifecycle
 * - Handle data mutations through Kernel API
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import { toRowId, type ColId, type RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import { KeyboardEventProcessor } from '@mog-sdk/kernel/keyboard';
import { createActor } from 'xstate';
import type { ClipboardPayload, ColumnSchema, ColumnTypeKind } from '../../domain/clipboard/types';
import {
  fromClipboardCellValue,
  toClipboardCellValue,
} from '../../domain/clipboard/cell-value-contract';
import type {
  CalendarViewConfig,
  TableId,
  ToolbarContext,
  Unsubscribe,
  ViewAdapter,
  ViewAdapterConfig,
  ViewId,
  ViewSelection,
} from '../types';
import type { CalendarEvent, CalendarRuntimeConfig } from './config';
import { detectPlatform } from '../../utils/platform';
import {
  CalendarEvents,
  calendarMachine,
  getCalendarSnapshot,
  type CalendarActor,
} from './machines/calendar-machine';

// =============================================================================
// Types
// =============================================================================

interface CalendarSelection {
  eventIds: string[];
  focusedEvent: string | null;
}

// =============================================================================
// Adapter Configuration
// =============================================================================

export interface CalendarViewAdapterConfig {
  viewId: ViewId;
  tableId: TableId;
  config: CalendarViewConfig;
  workbook?: Workbook;
}

// =============================================================================
// Adapter
// =============================================================================

export class CalendarViewAdapter implements ViewAdapter {
  readonly viewId: ViewId;
  readonly viewType = 'calendar' as const;

  private calendarConfig: CalendarViewConfig;
  private runtimeConfig: CalendarRuntimeConfig;
  private tableId: TableId;
  private workbook: Workbook | null = null;
  private actor: CalendarActor;

  private processor = new KeyboardEventProcessor(detectPlatform());

  // Internal state (cached from events for clipboard)
  private events: CalendarEvent[] = [];

  // Listeners
  private selectionListeners = new Set<(selection: ViewSelection) => void>();
  private toolbarListeners = new Set<(ctx: ToolbarContext) => void>();

  constructor(config: ViewAdapterConfig<'calendar'>) {
    this.viewId = config.viewId;
    this.tableId = config.tableId ?? ('' as TableId);
    this.calendarConfig = config.config as CalendarViewConfig;
    // Create runtime config with defaults
    this.runtimeConfig = {
      ...(config.config as CalendarViewConfig),
      weekStartsOn: 0, // Default
    } as CalendarRuntimeConfig;

    // Create state machine actor
    this.actor = createActor(calendarMachine);
    this.actor.start();

    // Subscribe to state changes to notify listeners
    this.actor.subscribe(() => {
      const selection = this.getSelection();
      this.selectionListeners.forEach((l) => l(selection));
      this.toolbarListeners.forEach((l) => l(this.getToolbarContext()));
    });
  }

  /**
   * Set the workbook for API access
   */
  setWorkbook(workbook: Workbook): void {
    this.workbook = workbook;
  }

  /**
   * Get the state machine actor (for CalendarView component)
   */
  getActor(): CalendarActor {
    return this.actor;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Selection Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getSelection(): ViewSelection {
    const snapshot = getCalendarSnapshot(this.actor.getSnapshot());
    return {
      type: 'calendar',
      data: {
        eventIds: snapshot.selectedEvents,
        focusedEvent: snapshot.focusedEvent,
      } as CalendarSelection,
    };
  }

  clearSelection(): void {
    this.actor.send(CalendarEvents.clearSelection());
  }

  selectAll(): void {
    // Select all visible events
    const eventIds = this.events.map((e) => e.rowId);
    this.actor.send(CalendarEvents.selectAll(eventIds));
  }

  onSelectionChange(listener: (selection: ViewSelection) => void): Unsubscribe {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Clipboard Contract (uses canonical ClipboardPayload format)
  // ═══════════════════════════════════════════════════════════════════════════

  getClipboardPayload(): ClipboardPayload {
    const snapshot = getCalendarSnapshot(this.actor.getSnapshot());
    const rowIds = snapshot.selectedEvents.map(toRowId);
    const selectedSet = new Set(snapshot.selectedEvents);

    // Build column IDs
    const colIds: ColId[] = [this.calendarConfig.dateColumn];
    if (this.runtimeConfig.titleColumn) {
      colIds.push(this.runtimeConfig.titleColumn);
    }
    if (this.runtimeConfig.endDateColumn) {
      colIds.push(this.runtimeConfig.endDateColumn);
    }
    if (this.runtimeConfig.colorByColumn) {
      colIds.push(this.runtimeConfig.colorByColumn);
    }

    // Build 2D cell values from events
    const cellValues: CellValue[][] = [];
    for (const event of this.events) {
      if (selectedSet.has(event.rowId)) {
        const row: CellValue[] = [toClipboardCellValue(event.startDate)];
        if (this.runtimeConfig.titleColumn) {
          row.push(event.title);
        }
        if (this.runtimeConfig.endDateColumn) {
          row.push(toClipboardCellValue(event.endDate));
        }
        if (this.runtimeConfig.colorByColumn) {
          row.push(event.color ?? null);
        }
        cellValues.push(row);
      }
    }

    // Build column schemas
    const columnSchemas: ColumnSchema[] = [
      { id: this.calendarConfig.dateColumn, name: 'Date', kind: 'date' },
    ];
    if (this.runtimeConfig.titleColumn) {
      columnSchemas.push({ id: this.runtimeConfig.titleColumn, name: 'Title', kind: 'text' });
    }
    if (this.runtimeConfig.endDateColumn) {
      columnSchemas.push({ id: this.runtimeConfig.endDateColumn, name: 'End Date', kind: 'date' });
    }
    if (this.runtimeConfig.colorByColumn) {
      columnSchemas.push({ id: this.runtimeConfig.colorByColumn, name: 'Color', kind: 'text' });
    }

    // Build text representation
    const lines = snapshot.selectedEvents.map((rowId) => {
      const event = this.events.find((e) => e.rowId === rowId);
      if (!event) return '';
      return `${event.title}\t${event.startDate.toLocaleDateString()}`;
    });

    return {
      cells: {
        values: cellValues,
        rowCount: cellValues.length,
        colCount: colIds.length,
      },
      tableContext: {
        tableId: this.tableId,
        rowIds,
        colIds,
        columnSchemas,
      },
      source: {
        viewType: 'calendar',
        viewId: this.viewId,
        sheetId: this.calendarConfig.sheetId,
      },
      text: lines.join('\n'),
    };
  }

  canPaste(payload: ClipboardPayload): boolean {
    // Calendar can paste cells or text
    return (payload.cells && payload.cells.rowCount > 0) || payload.text !== '';
  }

  paste(payload: ClipboardPayload): void {
    // Calendar paste creates new events via Kernel API
    if (payload.cells && payload.cells.values.length > 0) {
      const colIds = payload.tableContext?.colIds ?? [this.calendarConfig.dateColumn];

      for (let r = 0; r < payload.cells.values.length; r++) {
        const row = payload.cells.values[r];
        const values = new Map<ColId, CellValue>();

        for (let c = 0; c < row.length && c < colIds.length; c++) {
          const columnKind =
            payload.tableContext?.columnSchemas[c]?.kind ?? this.getClipboardColumnType(colIds[c]);
          values.set(colIds[c], fromClipboardCellValue(row[c], columnKind));
        }

        // Create event via Workbook API
        if (this.workbook) {
          void this.workbook.records.create(this.tableId, Object.fromEntries(values));
        }
      }
    } else if (payload.text) {
      // Parse text and create records
      this.pasteText(payload.text);
    }
  }

  /**
   * Parse TSV text and create events
   */
  private pasteText(text: string): void {
    const lines = text.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const [title, dateStr] = line.split('\t');
      if (title) {
        const values = new Map<ColId, CellValue>();
        if (this.runtimeConfig.titleColumn) {
          values.set(this.runtimeConfig.titleColumn, title);
        }
        if (dateStr) {
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            values.set(this.calendarConfig.dateColumn, fromClipboardCellValue(date, 'date'));
          }
        }
        // Create event via Workbook API
        if (this.workbook) {
          void this.workbook.records.create(this.tableId, Object.fromEntries(values));
        }
      }
    }
  }

  private getClipboardColumnType(colId: ColId): ColumnTypeKind | undefined {
    if (colId === this.calendarConfig.dateColumn || colId === this.runtimeConfig.endDateColumn) {
      return 'date';
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Edit Contract
  // ═══════════════════════════════════════════════════════════════════════════

  isEditing(): boolean {
    // Calendar doesn't have inline editing - uses dialogs
    return false;
  }

  startEdit(_target: unknown): void {
    // Open event detail dialog
    // This would be handled by the shell UI system
  }

  async commitEdit(): Promise<void> {
    // No-op for calendar (editing via dialogs)
  }

  cancelEdit(): void {
    // No-op for calendar
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getToolbarContext(): ToolbarContext {
    const snapshot = getCalendarSnapshot(this.actor.getSnapshot());
    const hasSelection = snapshot.selectedEvents.length > 0;

    return {
      formatting: {
        // Calendar events don't support rich text formatting
        canBold: false,
        canItalic: false,
        canUnderline: false,
        canChangeFont: false,
        canChangeFontSize: false,
        canChangeColor: true, // Event color
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
        textColor: this.getSelectedEventColor(snapshot.selectedEvents),
        fillColor: null,
        horizontalAlign: null,
        verticalAlign: null,
      },
      structure: {
        canInsertRow: true, // Create event
        canDeleteRow: hasSelection, // Delete selected events
        canInsertColumn: false,
        canDeleteColumn: false,
        canMerge: false,
        canUnmerge: false,
        canSort: false,
        canFilter: true,
      },
      selection: {
        hasSelection,
        selectionCount: snapshot.selectedEvents.length,
        selectionLabel: this.getSelectionLabel(snapshot.selectedEvents),
      },
    };
  }

  onToolbarContextChange(listener: (ctx: ToolbarContext) => void): Unsubscribe {
    this.toolbarListeners.add(listener);
    return () => this.toolbarListeners.delete(listener);
  }

  private getSelectedEventColor(selectedEvents: string[]): string | null {
    if (selectedEvents.length !== 1) return null;

    const eventId = selectedEvents[0];
    const event = this.events.find((e) => e.rowId === eventId);
    return event?.color ?? null;
  }

  private getSelectionLabel(selectedEvents: string[]): string {
    const count = selectedEvents.length;
    if (count === 0) return '';
    if (count === 1) {
      const eventId = selectedEvents[0];
      const event = this.events.find((e) => e.rowId === eventId);
      return event?.title ?? '1 event';
    }
    return `${count} events`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard
  // ═══════════════════════════════════════════════════════════════════════════

  handleKeyboard(event: KeyboardEvent): boolean {
    const input = this.processor.process(event);
    if (input.isComposing) return false;

    const snapshot = getCalendarSnapshot(this.actor.getSnapshot());

    // Delete selected events
    if (
      (input.physicalKey === 'Delete' || input.physicalKey === 'Backspace') &&
      snapshot.selectedEvents.length > 0
    ) {
      this.handleEventsDelete(snapshot.selectedEvents.map(toRowId));
      this.actor.send(CalendarEvents.clearSelection());
      return true;
    }

    // Escape to clear selection or cancel drag
    if (input.physicalKey === 'Escape') {
      if (snapshot.draggedEvent) {
        this.actor.send(CalendarEvents.dragCancel());
      } else {
        this.clearSelection();
      }
      return true;
    }

    // Ctrl/Cmd+A to select all
    if ((input.modifiers.ctrl || input.modifiers.meta) && input.character === 'a') {
      this.selectAll();
      return true;
    }

    // Send keyboard event to machine for any other handling
    this.actor.send(
      CalendarEvents.keyboard(
        input.character,
        input.modifiers.shift,
        input.modifiers.ctrl || input.modifiers.meta,
      ),
    );
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Formatting
  // ═══════════════════════════════════════════════════════════════════════════

  applyFormatting(_format: Partial<CellFormat>): void {
    // Calendar doesn't support cell formatting
    // Could potentially update event color
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  mount(_container: HTMLElement): void {
    // The actual rendering is done by React in CalendarView
    // This adapter provides the bridge to shell coordination
  }

  unmount(): void {
    // Keep state for caching
  }

  dispose(): void {
    this.actor.stop();
    this.events = [];
    this.selectionListeners.clear();
    this.toolbarListeners.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Calendar-specific methods (for integration with CalendarView component)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update the events data (called when data changes)
   */
  setEvents(events: CalendarEvent[]): void {
    this.events = events;
    // Selection is managed by state machine - no cleanup needed here
  }

  /**
   * Set runtime configuration (extended options)
   */
  setRuntimeConfig(config: Partial<CalendarRuntimeConfig>): void {
    this.runtimeConfig = { ...this.runtimeConfig, ...config };
  }

  /**
   * Get the current config
   */
  getConfig(): CalendarViewConfig {
    return this.calendarConfig;
  }

  /**
   * Get runtime config
   */
  getRuntimeConfig(): CalendarRuntimeConfig {
    return this.runtimeConfig;
  }

  /**
   * Get table ID
   */
  getTableId(): TableId {
    return this.tableId;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Mutation Handlers (wire to Kernel API)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle event creation.
   * Called from paste or date double-click.
   */
  handleEventCreate(values: Map<ColId, CellValue>): void {
    // Create event via Workbook API
    if (this.workbook) {
      void this.workbook.records.create(this.tableId, Object.fromEntries(values));
    }
  }

  /**
   * Handle event update (e.g., from drag to reschedule).
   */
  handleEventUpdate(rowId: RowId, values: Partial<Record<ColId, CellValue>>): void {
    // Update event via Workbook API
    if (this.workbook) {
      void this.workbook.records.update(this.tableId, rowId, values);
    }
  }

  /**
   * Handle event drag (reschedule).
   */
  handleEventDrag(rowId: RowId, newDate: Date): void {
    const values: Partial<Record<ColId, CellValue>> = {
      [this.calendarConfig.dateColumn]: newDate.toISOString(),
    };
    // Update event date via Workbook API
    if (this.workbook) {
      void this.workbook.records.update(this.tableId, rowId, values);
    }
  }

  /**
   * Handle event deletion.
   */
  handleEventsDelete(rowIds: RowId[]): void {
    // Delete events via Workbook API
    if (this.workbook) {
      for (const rowId of rowIds) {
        void this.workbook.records.remove(this.tableId, rowId);
      }
    }
  }
}
