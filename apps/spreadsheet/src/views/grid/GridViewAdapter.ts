import type { WorkbookInternal, Worksheet } from '@mog-sdk/contracts/api';
import { ensureFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import type { CellFormat, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { ClipboardPayload } from '../../domain/clipboard/types';
import { clipboardCellValueToText } from '../../domain/clipboard/cell-value-contract';
import { SelectionEvents } from '../../systems/grid-editing/machines/selection/events';
import { rangeToA1 } from '../../systems/shared/types';
import type {
  EditTarget,
  ToolbarContext,
  ViewAdapter,
  ViewAdapterConfig,
  ViewId,
  ViewSelection,
} from '../types';
import { GridCoordinator } from './coordinator/grid-coordinator';
import type { SheetCoordinatorConfig } from './coordinator/types';
import { setupGridRenderer, type GridRendererSetup } from './initialization';

/**
 * Selection snapshot structure returned by coordinator
 */
interface SelectionSnapshot {
  ranges: Array<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
    isFullRow?: boolean;
    isFullColumn?: boolean;
  }>;
  activeCell: { row: number; col: number };
}

export class GridViewAdapter implements ViewAdapter {
  readonly viewId: ViewId;
  readonly viewType = 'grid' as const;

  private coordinator: GridCoordinator | null = null;
  private rendererSetup: GridRendererSetup | null = null;
  private config: ViewAdapterConfig<'grid'>;
  private workbook: WorkbookInternal;

  private selectionListeners = new Set<(selection: ViewSelection) => void>();
  private toolbarListeners = new Set<(ctx: ToolbarContext) => void>();
  private selectionUnsubscribe: { unsubscribe: () => void } | null = null;

  constructor(config: ViewAdapterConfig<'grid'>) {
    this.viewId = config.viewId;
    this.config = config;
    this.workbook = config.workbook;
  }

  private getWorksheet(): Worksheet {
    return this.workbook.getSheetById(this.getActiveSheetId());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Selection Contract
  // ═══════════════════════════════════════════════════════════════════════════

  getSelection(): ViewSelection {
    if (!this.coordinator) {
      return {
        type: 'grid',
        data: {
          ranges: [],
          activeCell: null,
        },
      };
    }

    const snapshot = this.coordinator.grid.getSelectionSnapshot();
    return {
      type: 'grid',
      data: {
        ranges: snapshot.ranges,
        activeCell: snapshot.activeCell,
      },
    };
  }

  clearSelection(): void {
    if (!this.coordinator) return;
    // Reset selection to A1 (default starting cell)
    this.coordinator.grid.access.actors.selection.send(SelectionEvents.reset());
  }

  selectAll(): void {
    if (!this.coordinator) return;
    this.coordinator.grid.access.actors.selection.send(SelectionEvents.selectAll());
  }

  onSelectionChange(listener: (selection: ViewSelection) => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /**
   * Helper to get the current selection snapshot from coordinator.
   */
  private getSelectionSnapshotSafe(): SelectionSnapshot | null {
    if (!this.coordinator) return null;
    return this.coordinator.grid.getSelectionSnapshot() as SelectionSnapshot;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Clipboard Contract (uses canonical ClipboardPayload format)
  // ═══════════════════════════════════════════════════════════════════════════

  getClipboardPayload(): ClipboardPayload {
    const selection = this.getSelectionSnapshotSafe();
    const sheetId = this.getActiveSheetId();

    // No selection - return empty payload
    if (!selection || selection.ranges.length === 0) {
      return this.buildEmptyPayload(sheetId);
    }

    // Get the first selection range (primary selection)
    const range = selection.ranges[0];
    const rowCount = range.endRow - range.startRow + 1;
    const colCount = range.endCol - range.startCol + 1;

    // Build 2D cell values and formulas from selection
    const cellValues: CellValue[][] = [];
    const cellFormulas: (string | null)[][] = [];
    const cellFormats: (Partial<CellFormat> | null)[][] = [];

    const ws = this.getWorksheet();

    for (let r = 0; r < rowCount; r++) {
      const rowValues: CellValue[] = [];
      const rowFormulas: (string | null)[] = [];
      const rowFormats: (Partial<CellFormat> | null)[] = [];

      for (let c = 0; c < colCount; c++) {
        const row = range.startRow + r;
        const col = range.startCol + c;

        const vpCell = ws.viewport.getCellData(row, col);

        const value = vpCell ? vpCell.value : null;
        rowValues.push(value);

        // TODO: ViewportCell.hasFormula is boolean only — formula text not available sync.
        // Need ViewportCell.formula field or async getFormula(cellId) to restore formula copy.
        rowFormulas.push(null);

        // Get cell format from viewport
        rowFormats.push((vpCell?.format as Partial<CellFormat>) ?? null);
      }

      cellValues.push(rowValues);
      cellFormulas.push(rowFormulas);
      cellFormats.push(rowFormats);
    }

    // Check if any formulas are present
    const hasFormulas = cellFormulas.some((row) => row.some((f) => f !== null));

    return {
      cells: {
        values: cellValues,
        formulas: hasFormulas ? cellFormulas : undefined,
        formats: cellFormats,
        rowCount,
        colCount,
      },
      tableContext: undefined, // TODO: Add table context if selection is within a table
      source: {
        viewType: 'grid',
        viewId: this.viewId,
        sheetId,
      },
      text: this.buildTextFromCells(cellValues),
    };
  }

  canPaste(payload: ClipboardPayload): boolean {
    // Grid can paste cells or text
    return (payload.cells && payload.cells.rowCount > 0) || payload.text !== '';
  }

  paste(payload: ClipboardPayload): void {
    if (!this.coordinator) return;

    const selection = this.getSelectionSnapshotSafe();
    if (!selection) return;

    const targetCell = selection.activeCell;
    const sheetId = this.getActiveSheetId();

    // Prefer cells format (preserves structure and formulas)
    if (payload.cells && payload.cells.values.length > 0) {
      void this.pasteCells(
        payload.cells.values,
        payload.cells.formulas,
        targetCell.row,
        targetCell.col,
        sheetId,
      );
    } else if (payload.text) {
      void this.pasteText(payload.text, targetCell.row, targetCell.col, sheetId);
    }
  }

  private async pasteCells(
    cellValues: CellValue[][],
    cellFormulas: (string | null)[][] | undefined,
    targetRow: number,
    targetCol: number,
    sheetId: SheetId,
  ): Promise<void> {
    const ws = this.workbook.getSheetById(sheetId);

    // Collect all updates for batch write (1 IPC instead of N)
    const updates: Array<{ row: number; col: number; value: any }> = [];
    for (let r = 0; r < cellValues.length; r++) {
      const row = cellValues[r];
      for (let c = 0; c < row.length; c++) {
        const formula = cellFormulas?.[r]?.[c];
        const value = row[c];
        const destRow = targetRow + r;
        const destCol = targetCol + c;

        if (formula) {
          // ensureFormulaA1: clipboard formulas may come from external sources
          updates.push({ row: destRow, col: destCol, value: ensureFormulaA1(formula) as string });
        } else if (value !== null && value !== undefined) {
          updates.push({ row: destRow, col: destCol, value: String(value) });
        }
      }
    }
    if (updates.length > 0) {
      await ws.setCells(updates);
    }
  }

  private async pasteText(
    text: string,
    targetRow: number,
    targetCol: number,
    sheetId: SheetId,
  ): Promise<void> {
    // Parse TSV and paste at current selection
    const lines = text.split('\n').filter((line) => line.length > 0);
    const cellValues: CellValue[][] = lines.map((line) =>
      line.split('\t').map((cell) => cell.trim()),
    );
    await this.pasteCells(cellValues, undefined, targetRow, targetCol, sheetId);
  }

  private buildTextFromCells(cellValues: CellValue[][]): string {
    return cellValues
      .map((row) => row.map((cell) => clipboardCellValueToText(cell)).join('\t'))
      .join('\n');
  }

  private buildEmptyPayload(sheetId: SheetId): ClipboardPayload {
    return {
      cells: {
        values: [],
        rowCount: 0,
        colCount: 0,
      },
      source: {
        viewType: 'grid',
        viewId: this.viewId,
        sheetId,
      },
      text: '',
    };
  }

  private getActiveSheetId(): SheetId {
    // Get from coordinator if available, otherwise use config
    return this.config.config.sheetId as SheetId;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Edit Contract
  // ═══════════════════════════════════════════════════════════════════════════

  isEditing(): boolean {
    if (!this.coordinator) return false;

    const editorSnapshot = this.coordinator.grid.getEditorSnapshot();
    // Editor is editing if it's in any of the editing states
    return editorSnapshot.isEditing;
  }

  startEdit(target: EditTarget): void {
    if (!this.coordinator) return;

    // Target can be a cell coordinate or use the active cell
    const editTarget = target as { row?: number; col?: number } | undefined;
    const selection = this.getSelectionSnapshotSafe();

    let cell: { row: number; col: number };
    if (editTarget?.row !== undefined && editTarget?.col !== undefined) {
      cell = { row: editTarget.row, col: editTarget.col };
    } else if (selection) {
      cell = selection.activeCell;
    } else {
      return; // No valid cell to edit
    }

    const sheetId = this.getActiveSheetId();

    // Start editing via the coordinator
    this.coordinator.grid.startEditing(cell, sheetId);
  }

  async commitEdit(): Promise<void> {
    if (!this.coordinator) return;
    // Commit current edit with no direction (stay in place)
    this.coordinator.grid.commitEdit('none');
  }

  cancelEdit(): void {
    if (!this.coordinator) return;
    this.coordinator.grid.cancelEdit();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Toolbar Contract (CRITICAL: View-agnostic)
  // ═══════════════════════════════════════════════════════════════════════════

  getToolbarContext(): ToolbarContext {
    const selection = this.getSelectionSnapshotSafe();
    const hasSelection = selection !== null && selection.ranges.length > 0;

    // Compute selection info
    let selectionCount = 0;
    let selectionLabel = '';

    if (selection && selection.ranges.length > 0) {
      // Count cells in selection
      for (const range of selection.ranges) {
        const rows = range.endRow - range.startRow + 1;
        const cols = range.endCol - range.startCol + 1;
        selectionCount += rows * cols;
      }

      // Create human-readable label
      if (selection.ranges.length === 1) {
        selectionLabel = rangeToA1(selection.ranges[0]);
      } else {
        selectionLabel = `${selection.ranges.length} ranges`;
      }
    }

    // Get format state from active cell
    const formatState = this.getActiveCellFormatState();

    return {
      formatting: {
        canBold: true,
        canItalic: true,
        canUnderline: true,
        canChangeFont: true,
        canChangeFontSize: true,
        canChangeColor: true,
        canChangeFillColor: true,
        canChangeAlignment: true,
        canChangeBorders: true,
      },
      state: formatState,
      structure: {
        canInsertRow: true,
        canDeleteRow: hasSelection,
        canInsertColumn: true,
        canDeleteColumn: hasSelection,
        canMerge: hasSelection && selectionCount > 1,
        canUnmerge: false, // TODO: Check if selection contains merged cells
        canSort: hasSelection,
        canFilter: true,
      },
      selection: {
        hasSelection,
        selectionCount,
        selectionLabel,
      },
    };
  }

  /**
   * Get format state from the active cell for toolbar display.
   */
  private getActiveCellFormatState(): ToolbarContext['state'] {
    const selection = this.getSelectionSnapshotSafe();
    if (!selection) {
      return {
        isBold: null,
        isItalic: null,
        isUnderline: null,
        fontFamily: null,
        fontSize: null,
        textColor: null,
        fillColor: null,
        horizontalAlign: null,
        verticalAlign: null,
      };
    }

    const { activeCell } = selection;
    // Sync viewport read via Worksheet API (replaces ctx.viewportBuffer)
    const ws = this.getWorksheet();
    const cellData = ws?.viewport.getCellData(activeCell.row, activeCell.col);
    const format = cellData?.format as CellFormat | null;

    if (!format) {
      return {
        isBold: false,
        isItalic: false,
        isUnderline: false,
        fontFamily: null,
        fontSize: null,
        textColor: null,
        fillColor: null,
        horizontalAlign: null,
        verticalAlign: null,
      };
    }

    // Map CellFormat alignment values to ToolbarContext's limited set
    const hAlign = format.horizontalAlign;
    const vAlign = format.verticalAlign;
    const rawVAlign = vAlign as string | undefined;

    return {
      isBold: format.bold ?? false,
      isItalic: format.italic ?? false,
      isUnderline: format.underlineType ? true : false,
      fontFamily: format.fontFamily ?? null,
      fontSize: format.fontSize ?? null,
      textColor: format.fontColor ?? null,
      fillColor: format.backgroundColor ?? null,
      // Map to limited toolbar values (left, center, right, or null)
      horizontalAlign:
        hAlign === 'left' || hAlign === 'center' || hAlign === 'right' ? hAlign : null,
      // Map canonical token to the toolbar's three-button state. Legacy raw
      // `center` is treated as middle; justify/distributed fall outside this
      // set, so they show no active button (null).
      verticalAlign:
        rawVAlign === 'top' || rawVAlign === 'bottom'
          ? rawVAlign
          : rawVAlign === 'middle' || rawVAlign === 'center'
            ? 'middle'
            : null,
    };
  }

  onToolbarContextChange(listener: (ctx: ToolbarContext) => void): () => void {
    this.toolbarListeners.add(listener);
    return () => this.toolbarListeners.delete(listener);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Keyboard
  // ═══════════════════════════════════════════════════════════════════════════

  handleKeyboard(event: KeyboardEvent): boolean {
    if (!this.coordinator) return false;

    // Delegate to the coordinator's keyboard coordinator
    const keyboardCoordinator = this.coordinator.input.keyboardCoordinator;
    if (!keyboardCoordinator) return false;

    const result = keyboardCoordinator.handleKeyboardEvent(event);
    return result.handled;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Formatting (view decides how to apply)
  // ═══════════════════════════════════════════════════════════════════════════

  async applyFormatting(format: Partial<CellFormat>): Promise<void> {
    if (!this.coordinator) return;

    const selection = this.getSelectionSnapshotSafe();
    if (!selection || selection.ranges.length === 0) return;

    const sheetId = this.getActiveSheetId();

    const ws = this.workbook.getSheetById(sheetId);
    void ws.formats.setRanges(selection.ranges, format);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle (CRITICAL: Supports adapter caching)
  // ═══════════════════════════════════════════════════════════════════════════

  mount(container: HTMLElement): void {
    if (!this.coordinator) {
      const coordinatorConfig: SheetCoordinatorConfig = {
        initialSheetId: this.config.config.sheetId,
        workbook: this.workbook,
        enableKeyboard: true,
      };

      this.coordinator = new GridCoordinator(coordinatorConfig);

      this.subscribeToSelectionChanges();
    }

    this.coordinator.renderer.mount(container);

    if (!this.rendererSetup) {
      this.rendererSetup = setupGridRenderer({
        coordinator: this.coordinator,
        sheetId: this.config.config.sheetId,
        container,
      });
    }
  }

  unmount(): void {
    // Clean up renderer setup (disconnect resize observer)
    this.rendererSetup?.cleanup();
    this.rendererSetup = null;

    // Detach from DOM but keep state (for caching)
    this.coordinator?.renderer.unmount();
  }

  dispose(): void {
    // Clean up renderer setup
    this.rendererSetup?.cleanup();
    this.rendererSetup = null;

    // Clean up selection subscription
    if (this.selectionUnsubscribe) {
      this.selectionUnsubscribe.unsubscribe();
      this.selectionUnsubscribe = null;
    }

    // Full cleanup
    this.coordinator?.dispose();
    this.coordinator = null;
    this.selectionListeners.clear();
    this.toolbarListeners.clear();
  }

  /**
   * Subscribe to selection actor changes and notify listeners.
   */
  private subscribeToSelectionChanges(): void {
    if (!this.coordinator) return;

    const selectionActor = this.coordinator.grid.access.actors.selection;
    this.selectionUnsubscribe = selectionActor.subscribe(() => {
      const selection = this.getSelection();
      this.selectionListeners.forEach((listener) => listener(selection));

      // Also update toolbar context
      const toolbarContext = this.getToolbarContext();
      this.toolbarListeners.forEach((listener) => listener(toolbarContext));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Grid-specific methods (called by action handlers)
  // ═══════════════════════════════════════════════════════════════════════════

  toggleBold(): void {
    const formatState = this.getActiveCellFormatState();
    const newBold = formatState.isBold !== true;
    void this.applyFormatting({ bold: newBold });
  }

  toggleItalic(): void {
    const formatState = this.getActiveCellFormatState();
    const newItalic = formatState.isItalic !== true;
    void this.applyFormatting({ italic: newItalic });
  }

  async fillDown(): Promise<void> {
    const selection = this.getSelectionSnapshotSafe();
    if (!selection || selection.ranges.length === 0) return;

    const range = selection.ranges[0];
    if (range.startRow === range.endRow) return; // Need at least 2 rows

    const sheetId = this.getActiveSheetId();
    const ws = this.workbook.getSheetById(sheetId);

    const updates: Array<{ row: number; col: number; value: any }> = [];
    for (let col = range.startCol; col <= range.endCol; col++) {
      const vpCell = ws.viewport.getCellData(range.startRow, col);
      // TODO: hasFormula is boolean only — formula text not available sync.
      // Fill currently copies values only; formula fill requires ViewportCell.formula field.
      const sourceValue = vpCell ? vpCell.value : null;
      const valueStr = clipboardCellValueToText(sourceValue);

      for (let row = range.startRow + 1; row <= range.endRow; row++) {
        updates.push({ row, col, value: valueStr });
      }
    }
    if (updates.length > 0) {
      await ws.setCells(updates);
    }
  }

  async fillRight(): Promise<void> {
    const selection = this.getSelectionSnapshotSafe();
    if (!selection || selection.ranges.length === 0) return;

    const range = selection.ranges[0];
    if (range.startCol === range.endCol) return; // Need at least 2 columns

    const sheetId = this.getActiveSheetId();
    const ws = this.workbook.getSheetById(sheetId);

    const updates: Array<{ row: number; col: number; value: any }> = [];
    for (let row = range.startRow; row <= range.endRow; row++) {
      const vpCell = ws.viewport.getCellData(row, range.startCol);
      // TODO: hasFormula is boolean only — formula text not available sync.
      // Fill currently copies values only; formula fill requires ViewportCell.formula field.
      const sourceValue = vpCell ? vpCell.value : null;
      const valueStr = clipboardCellValueToText(sourceValue);

      for (let col = range.startCol + 1; col <= range.endCol; col++) {
        updates.push({ row, col, value: valueStr });
      }
    }
    if (updates.length > 0) {
      await ws.setCells(updates);
    }
  }

  /**
   * Get the GridCoordinator instance for advanced operations.
   * Returns null if not mounted.
   */
  getCoordinator(): GridCoordinator | null {
    return this.coordinator;
  }
}
