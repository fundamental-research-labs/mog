/**
 * GalleryViewAdapter
 *
 * Implements the ViewAdapter interface for Gallery view.
 * Bridges the state machine, data layer, and React rendering.
 *
 * Key responsibilities:
 * - Implement all ViewAdapter contracts (selection, clipboard, edit, toolbar)
 * - Manage state machine lifecycle
 * - Handle data mutations through Kernel API
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import { KeyboardEventProcessor } from '@mog-sdk/kernel/keyboard';
import { createActor } from 'xstate';
import type { ClipboardPayload, ColumnSchema } from '../../domain/clipboard/types';
import {
  clipboardCellValueToText,
  fromClipboardCellValue,
  toClipboardCellValue,
} from '../../domain/clipboard/cell-value-contract';
import type {
  TableId,
  ToolbarContext,
  Unsubscribe,
  ViewAdapter,
  ViewAdapterConfig,
  ViewId,
  ViewSelection,
} from '../types';
import type { GalleryViewConfig } from './config';
import { detectPlatform } from '../../utils/platform';
import {
  GalleryEvents,
  galleryMachine,
  getGallerySnapshot,
  type GalleryActor,
  type GalleryKeyModifiers,
} from './machines';

// Use the view-specific name locally
type KeyModifiers = GalleryKeyModifiers;

// =============================================================================
// Types
// =============================================================================

/**
 * Gallery-specific selection data.
 */
export interface GallerySelection {
  /** Selected card IDs (row IDs) */
  cardIds: RowId[];
  /** Currently focused card (for keyboard navigation) */
  focusedCard: RowId | null;
}

/**
 * Configuration for creating a GalleryViewAdapter.
 */
export interface GalleryViewAdapterConfig {
  viewId: ViewId;
  tableId: TableId;
  config: GalleryViewConfig;
  workbook?: Workbook;
}

// =============================================================================
// Adapter
// =============================================================================

export class GalleryViewAdapter implements ViewAdapter {
  readonly viewId: ViewId;
  readonly viewType = 'gallery' as const;

  private galleryConfig: GalleryViewConfig;
  private tableId: TableId;
  private workbook: Workbook | null = null;
  private actor: GalleryActor;
  private processor = new KeyboardEventProcessor(detectPlatform());

  // Cached data for clipboard operations
  private allCardIds: RowId[] = [];

  // Listeners
  private selectionListeners = new Set<(selection: ViewSelection) => void>();
  private toolbarListeners = new Set<(ctx: ToolbarContext) => void>();

  constructor(config: ViewAdapterConfig<'gallery'>) {
    this.viewId = config.viewId;
    this.tableId = config.tableId ?? ('' as TableId);
    this.galleryConfig = config.config as GalleryViewConfig;

    // Create state machine actor
    this.actor = createActor(galleryMachine);
    this.actor.start();

    // Subscribe to state changes to notify listeners
    this.actor.subscribe(() => {
      const selection = this.getSelection();
      this.selectionListeners.forEach((l) => l(selection));
      this.toolbarListeners.forEach((l) => l(this.getToolbarContext()));
    });
  }

  /**
   * Set the workbook for Kernel API access.
   */
  setWorkbook(workbook: Workbook): void {
    this.workbook = workbook;
  }

  /**
   * Get the state machine actor (for GalleryView component).
   */
  getActor(): GalleryActor {
    return this.actor;
  }

  /**
   * Update the list of all card IDs (for selectAll functionality).
   */
  setAllCardIds(cardIds: RowId[]): void {
    this.allCardIds = cardIds;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Selection Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getSelection(): ViewSelection {
    const snapshot = getGallerySnapshot(this.actor.getSnapshot());
    return {
      type: 'gallery',
      data: {
        cardIds: snapshot.selectedCards,
        focusedCard: snapshot.focusedCard,
      } as GallerySelection,
    };
  }

  clearSelection(): void {
    this.actor.send(GalleryEvents.clearSelection());
  }

  selectAll(): void {
    // Select all cards using the cached card IDs
    this.actor.send(GalleryEvents.selectAll(this.allCardIds));
  }

  onSelectionChange(listener: (selection: ViewSelection) => void): Unsubscribe {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /**
   * Select a card (click).
   * Supports shift+click for range selection and ctrl/cmd+click for toggle.
   */
  selectCard(cardId: RowId, shiftKey = false, ctrlKey = false): void {
    const modifiers: KeyModifiers = {
      shiftKey,
      ctrlKey,
      metaKey: false,
      altKey: false,
    };
    this.actor.send(GalleryEvents.cardClick(cardId, modifiers));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Clipboard Contract (uses canonical ClipboardPayload format)
  // ═══════════════════════════════════════════════════════════════════════════

  async getClipboardPayload(): Promise<ClipboardPayload> {
    const snapshot = getGallerySnapshot(this.actor.getSnapshot());
    const rowIds = snapshot.selectedCards;
    const colIds = this.getVisibleColumnIds();

    // Build 2D cell values from selected records
    const cellValues: CellValue[][] = [];
    for (const rowId of rowIds) {
      const record = this.workbook ? await this.workbook.records.get(this.tableId, rowId) : null;
      cellValues.push(colIds.map((colId) => toClipboardCellValue(record?.values[colId] ?? null)));
    }

    // Build column schemas
    // TODO: Get actual column names from Kernel.Schema when available:
    // const columnSchemas: ColumnSchema[] = colIds.map((colId) => {
    // const schema = Schema.getColumn(this.workbook!, this.tableId, colId);
    // return { id: colId, name: schema?.name ?? colId, kind: schema?.kind ?? 'text' };
    // });
    const columnSchemas: ColumnSchema[] = colIds.map((colId) => ({
      id: colId,
      name: colId,
      kind: 'text' as const,
    }));

    // Build text representation (TSV)
    const header = colIds.join('\t');
    const dataRows: string[] = [];
    for (const rowId of rowIds) {
      const record = this.workbook ? await this.workbook.records.get(this.tableId, rowId) : null;
      dataRows.push(
        colIds.map((colId) => clipboardCellValueToText(record?.values[colId] ?? null)).join('\t'),
      );
    }

    return {
      cells: {
        values: cellValues,
        rowCount: rowIds.length,
        colCount: colIds.length,
      },
      tableContext:
        rowIds.length > 0
          ? {
              tableId: this.tableId,
              rowIds,
              colIds,
              columnSchemas,
            }
          : undefined,
      source: {
        viewType: 'gallery',
        viewId: this.viewId,
        sheetId: this.galleryConfig.sheetId,
      },
      text: [header, ...dataRows].join('\n'),
    };
  }

  canPaste(payload: ClipboardPayload): boolean {
    // Gallery can paste cells or text to create new cards
    return (payload.cells && payload.cells.rowCount > 0) || payload.text !== '';
  }

  paste(payload: ClipboardPayload): void {
    // Create new records from pasted data
    if (payload.cells && payload.cells.values.length > 0) {
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
        this.handleCardCreate(values);
      }
    } else if (payload.text) {
      // Parse TSV and create records
      this.pasteText(payload.text);
    }
  }

  /**
   * Parse TSV text and create records.
   */
  private pasteText(text: string): void {
    const lines = text.split('\n').filter((l) => l.trim());
    // Skip header row if it looks like one
    const startIndex = lines.length > 1 && lines[0].includes('\t') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const cells = lines[i].split('\t');
      const colIds = this.getVisibleColumnIds();
      const values: Record<ColId, CellValue> = {};

      for (let c = 0; c < cells.length && c < colIds.length; c++) {
        values[colIds[c]] = cells[c].trim();
      }

      this.handleCardCreate(values);
    }
  }

  private getVisibleColumnIds(): ColId[] {
    const cols: ColId[] = [this.galleryConfig.titleColumn];
    if (this.galleryConfig.coverImageColumn) {
      cols.push(this.galleryConfig.coverImageColumn);
    }
    cols.push(...this.galleryConfig.cardFields);
    return cols;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Edit Contract
  // ═══════════════════════════════════════════════════════════════════════════

  isEditing(): boolean {
    const snapshot = getGallerySnapshot(this.actor.getSnapshot());
    return snapshot.editingCard !== null;
  }

  startEdit(target: unknown): void {
    // Target should be { cardId: RowId, fieldId?: ColId }
    const t = target as { cardId: RowId; fieldId?: ColId };
    if (t.cardId) {
      this.actor.send(
        GalleryEvents.startEdit(t.cardId, t.fieldId || this.galleryConfig.titleColumn),
      );
    }
  }

  async commitEdit(): Promise<void> {
    this.actor.send(GalleryEvents.commitEdit());
  }

  cancelEdit(): void {
    this.actor.send(GalleryEvents.cancelEdit());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getToolbarContext(): ToolbarContext {
    const snapshot = getGallerySnapshot(this.actor.getSnapshot());
    const hasSelection = snapshot.selectedCards.length > 0;

    return {
      formatting: {
        // Gallery cards don't support text formatting
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
        canInsertRow: true, // Can add new card/record
        canDeleteRow: hasSelection,
        canInsertColumn: false,
        canDeleteColumn: false,
        canMerge: false,
        canUnmerge: false,
        canSort: true,
        canFilter: true,
      },
      selection: {
        hasSelection,
        selectionCount: snapshot.selectedCards.length,
        selectionLabel: this.getSelectionLabel(snapshot.selectedCards),
      },
    };
  }

  onToolbarContextChange(listener: (ctx: ToolbarContext) => void): Unsubscribe {
    this.toolbarListeners.add(listener);
    return () => this.toolbarListeners.delete(listener);
  }

  private getSelectionLabel(selectedCards: RowId[]): string {
    if (selectedCards.length === 0) return '';
    if (selectedCards.length === 1) return '1 card';
    return `${selectedCards.length} cards`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard
  // ═══════════════════════════════════════════════════════════════════════════

  handleKeyboard(event: KeyboardEvent): boolean {
    const input = this.processor.process(event);
    if (input.isComposing) return false;

    const snapshot = getGallerySnapshot(this.actor.getSnapshot());

    const modifiers: KeyModifiers = {
      shiftKey: input.modifiers.shift,
      ctrlKey: input.modifiers.ctrl,
      metaKey: input.modifiers.meta,
      altKey: input.modifiers.alt,
    };
    const cmdKey = input.modifiers.ctrl || input.modifiers.meta;

    switch (input.character) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        // Navigation between cards
        // Would need grid layout info to properly navigate
        this.actor.send(GalleryEvents.keyboard(input.character, modifiers));
        return true;

      case 'Enter':
        // Open record detail or start editing
        if (snapshot.focusedCard && !snapshot.editingCard) {
          this.actor.send(GalleryEvents.cardDoubleClick(snapshot.focusedCard));
          return true;
        }
        return false;

      case 'Delete':
      case 'Backspace':
        // Delete selected cards
        if (snapshot.selectedCards.length > 0 && !snapshot.editingCard) {
          this.handleCardsDelete(snapshot.selectedCards);
          this.actor.send(GalleryEvents.clearSelection());
          return true;
        }
        return false;

      case 'a':
        if (cmdKey) {
          this.selectAll();
          return true;
        }
        return false;

      case 'Escape':
        if (snapshot.editingCard) {
          this.actor.send(GalleryEvents.cancelEdit());
          return true;
        }
        if (snapshot.selectedCards.length > 0) {
          this.clearSelection();
          return true;
        }
        return false;

      default:
        this.actor.send(GalleryEvents.keyboard(input.character, modifiers));
        return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Formatting
  // ═══════════════════════════════════════════════════════════════════════════

  applyFormatting(_format: Partial<CellFormat>): void {
    // Gallery view doesn't support cell formatting
    // Could potentially apply to card appearance in the future
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  mount(_containerEl: HTMLElement): void {
    // The actual React component will be rendered by GalleryView.tsx
  }

  unmount(): void {
    // Keep state (selection, scroll position) for caching
  }

  dispose(): void {
    // Full cleanup
    this.actor.stop();
    this.allCardIds = [];
    this.selectionListeners.clear();
    this.toolbarListeners.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gallery-specific methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the current gallery configuration.
   */
  getConfig(): GalleryViewConfig {
    return this.galleryConfig;
  }

  /**
   * Update gallery configuration.
   */
  updateConfig(changes: Partial<GalleryViewConfig>): void {
    this.galleryConfig = { ...this.galleryConfig, ...changes };
    this.toolbarListeners.forEach((l) => l(this.getToolbarContext()));
  }

  /**
   * Get the focused card ID.
   */
  getFocusedCard(): RowId | null {
    const snapshot = getGallerySnapshot(this.actor.getSnapshot());
    return snapshot.focusedCard;
  }

  /**
   * Get selected card IDs.
   */
  getSelectedCards(): RowId[] {
    const snapshot = getGallerySnapshot(this.actor.getSnapshot());
    return snapshot.selectedCards;
  }

  /**
   * Get table ID.
   */
  getTableId(): TableId {
    return this.tableId;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Mutation Handlers (wire to Kernel API)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle card creation.
   * Called from paste operations.
   */
  handleCardCreate(values: Record<ColId, CellValue>): void {
    // Create card via Kernel API
    if (this.workbook) {
      void this.workbook.records.create(this.tableId, values);
    }
  }

  /**
   * Handle card update.
   */
  handleCardUpdate(rowId: RowId, values: Partial<Record<ColId, CellValue>>): void {
    // Update card via Kernel API
    if (this.workbook) {
      void this.workbook.records.update(this.tableId, rowId, values);
    }
  }

  /**
   * Handle card deletion.
   */
  handleCardsDelete(rowIds: RowId[]): void {
    // Delete cards via Kernel API
    if (this.workbook) {
      for (const rowId of rowIds) {
        void this.workbook.records.remove(this.tableId, rowId);
      }
    }
  }
}
