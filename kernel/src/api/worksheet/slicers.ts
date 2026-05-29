/**
 * WorksheetSlicersImpl — Implementation of the WorksheetSlicers sub-API.
 *
 * Calls computeBridge directly instead of delegating through operations + unwrap.
 */
import type {
  SheetId,
  Slicer,
  SlicerConfig,
  SlicerInfo,
  SlicerItem,
  SlicerState,
  WorksheetSlicers,
} from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type CellValue } from '@mog-sdk/contracts/core';
import type {
  FloatingObjectAnchor,
  StoredSlicer,
  StoredSlicerUpdate,
} from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';
import * as Filters from '../../domain/sorting/filters';
import { getTable } from '../../domain/tables/core';
import { KernelError } from '../../errors';
import { columnFilterCriteriaToCompute } from '../../bridges/compute/compute-wire-converters';
import { extractMutationData } from '../../bridges/compute/compute-core';
import {
  assertSlicerFilteringAllowed,
  assertSlicerObjectEditAllowed,
  assertSlicerObjectTopologyAllowed,
  getActiveProtectionOptions,
} from './protected-table-operations';

/** English Metric Units per pixel at 96 DPI (1 px = 9525 EMU). */
const EMU_PER_PX = 9525;

function defaultAnchor(): FloatingObjectAnchor {
  return {
    anchorRow: 0,
    anchorCol: 0,
    anchorRowOffsetEmu: 0,
    anchorColOffsetEmu: 0,
    anchorMode: 'absolute',
  };
}

/**
 * Extract pixel-space x/y/width/height from a `FloatingObjectAnchor`
 * for public `Slicer` API projections.
 */
function anchorToPixelBounds(anchor: FloatingObjectAnchor | undefined | null): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (!anchor) {
    return { x: 0, y: 0, width: 200, height: 300 };
  }
  return {
    x: anchor.anchorColOffsetEmu / EMU_PER_PX,
    y: anchor.anchorRowOffsetEmu / EMU_PER_PX,
    width: anchor.extentCxEmu != null ? anchor.extentCxEmu / EMU_PER_PX : 200,
    height: anchor.extentCyEmu != null ? anchor.extentCyEmu / EMU_PER_PX : 300,
  };
}

/**
 * Convert a pixel-rectangle from `SlicerConfig.position` into a
 * `FloatingObjectAnchor` (absolute mode) for Rust persistence.
 */
function pixelRectToAnchor(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): FloatingObjectAnchor {
  return {
    anchorRow: 0,
    anchorCol: 0,
    anchorRowOffsetEmu: Math.round(rect.y * EMU_PER_PX),
    anchorColOffsetEmu: Math.round(rect.x * EMU_PER_PX),
    anchorMode: 'absolute',
    extentCxEmu: Math.round(rect.width * EMU_PER_PX),
    extentCyEmu: Math.round(rect.height * EMU_PER_PX),
  };
}

/**
 * Extract a plain CellValue from the Rust-serialized cell value format.
 * getCellsInRangeYrs returns values like {type:"text",value:"..."} or primitives.
 */
function extractCellValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object' && v !== null && 'type' in v) {
    const obj = v as Record<string, unknown>;
    if (obj.type === 'text') return String(obj.value ?? '');
    if (obj.type === 'error') return null;
    // number, boolean come through as primitives in JSON
  }
  return null;
}

function validateSlicerId(slicerId: string, operation: string): void {
  if (typeof slicerId !== 'string' || slicerId.length === 0) {
    throw new KernelError('COMPUTE_ERROR', `${operation}: slicerId must be a non-empty string`);
  }
}

export class WorksheetSlicersImpl implements WorksheetSlicers {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  /**
   * Validate that the given slicer name is unique across the workbook.
   * Throws KernelError if a slicer with the same name already exists.
   */
  private async validateNameUnique(name: string, excludeSlicerId?: string): Promise<void> {
    const allSlicers = await this.ctx.computeBridge.getAllSlicersWorkbook();
    const conflict = allSlicers.find((s) => {
      if (excludeSlicerId && s.id === excludeSlicerId) return false;
      const existingName = (s.name ?? s.caption)?.toLowerCase();
      return existingName === name.toLowerCase();
    });
    if (conflict) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `A slicer with name "${name}" already exists (id: ${conflict.id}). Slicer names must be unique within a workbook.`,
      );
    }
  }

  async add(config: SlicerConfig): Promise<Slicer> {
    await assertSlicerObjectTopologyAllowed(
      this.ctx,
      this.sheetId,
      'slicers.add',
      config.name ?? config.caption,
    );
    // Validate name uniqueness across the workbook if a name is provided.
    const resolvedName = config.name ?? config.caption ?? '';
    if (resolvedName) {
      await this.validateNameUnique(resolvedName);
    }

    // Map contract SlicerConfig → Rust StoredSlicer for the bridge.
    const caption = config.caption ?? config.name ?? '';
    const source = config.source ?? {
      type: 'table' as const,
      tableId: config.tableName ?? '',
      columnCellId: config.columnName ?? '',
    };
    const defaultStyle: StoredSlicer['style'] = {
      columnCount: 1,
      buttonHeight: 30,
      showSelectionIndicator: true,
      crossFilter: 'showItemsWithDataAtTop',
      customListSort: true,
      showItemsWithNoData: true,
      sortOrder: 'ascending',
    };
    const storedConfig: StoredSlicer = {
      id: config.id ?? '',
      sheetId: config.sheetId ?? this.sheetId,
      source,
      caption,
      name: config.name,
      style: config.style ?? defaultStyle,
      position: config.position ? pixelRectToAnchor(config.position) : undefined,
      level: 0,
      zIndex: config.zIndex ?? 0,
      locked: config.locked ?? false,
      showHeader: config.showHeader ?? true,
      multiSelect: config.multiSelect ?? true,
      selectedValues: config.selectedValues ?? [],
    };
    const result = await this.ctx.computeBridge.createSlicer(this.sheetId, storedConfig);
    const created = result ? extractMutationData<StoredSlicer>(result) : undefined;
    const slicerId = created?.id ?? storedConfig.id;

    // Read back the full slicer entity.
    const full = await this.get(slicerId);
    if (full) return full;

    // Fallback: construct from config if read-back fails.
    const pos = config.position as
      | {
          x?: number;
          y?: number;
          width?: number;
          height?: number;
        }
      | undefined;
    return {
      id: slicerId,
      name: config.name ?? caption,
      caption,
      tableName: source.type === 'table' ? source.tableId : '',
      columnName: source.type === 'table' ? source.columnCellId : '',
      selectedItems: config.selectedValues ?? [],
      position: {
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        width: pos?.width ?? 200,
        height: pos?.height ?? 300,
      },
    };
  }

  async remove(slicerId: string): Promise<void> {
    validateSlicerId(slicerId, 'deleteSlicer');
    await assertSlicerObjectTopologyAllowed(this.ctx, this.sheetId, 'slicers.remove', slicerId);
    await this.ctx.computeBridge.deleteSlicer(this.sheetId, slicerId);
  }

  async getByName(name: string): Promise<Slicer | null> {
    const slicers = await this.list();
    const match = slicers.find((s) => s.name === name);
    if (!match) return null;
    return this.get(match.id);
  }

  async clear(): Promise<void> {
    const slicers = await this.list();
    for (const slicer of slicers) {
      await assertSlicerObjectTopologyAllowed(this.ctx, this.sheetId, 'slicers.clear', slicer.name);
    }
    for (const slicer of slicers) {
      await this.remove(slicer.id);
    }
  }

  async list(): Promise<SlicerInfo[]> {
    const slicers = await this.ctx.computeBridge.getAllSlicers(this.sheetId);
    return slicers.map((s) => ({
      id: s.id,
      name: s.name ?? s.caption,
      caption: s.caption,
      tableName: s.source.type === 'table' ? s.source.tableId : '',
      columnName: s.source.type === 'table' ? s.source.columnCellId : '',
    }));
  }

  async getItemAt(index: number): Promise<SlicerInfo | null> {
    const slicers = await this.list();
    return slicers[index] ?? null;
  }

  async has(slicerId: string): Promise<boolean> {
    return (await this.get(slicerId)) !== null;
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async get(slicerId: string): Promise<Slicer | null> {
    const state = await this.ctx.computeBridge.getSlicerState(this.sheetId, slicerId);
    if (!state) {
      return null;
    }
    return {
      id: slicerId,
      name: state.name ?? state.caption,
      caption: state.caption,
      tableName: state.source.type === 'table' ? state.source.tableId : '',
      columnName: state.source.type === 'table' ? state.source.columnCellId : '',
      selectedItems: state.selectedValues,
      position: anchorToPixelBounds(state.position),
    };
  }

  async getItems(slicerId: string): Promise<SlicerItem[]> {
    validateSlicerId(slicerId, 'getItems');

    // 1. Get stored slicer state
    const stored = await this.ctx.computeBridge.getSlicerState(this.sheetId, slicerId);
    if (!stored) return [];

    // Dispatch to pivot-specific logic for pivot slicers
    if (stored.source.type === 'pivot') {
      return this.getPivotSlicerItems(stored);
    }

    if (stored.source.type !== 'table') return [];

    // 2. Get the table to find column position and data range
    const table = await this.ctx.computeBridge.getTableByName(stored.source.tableId);
    if (!table) return [];

    // 3. Find column index by matching header cell values
    const columnName = (stored.source as { type: 'table'; columnCellId: string }).columnCellId;
    let absCol = -1;

    // First try table.columns if populated
    if (table.columns.length > 0) {
      const colIndex = table.columns.findIndex((c) => c.name === columnName || c.id === columnName);
      if (colIndex >= 0) absCol = table.range.startCol + colIndex;
    }

    // Fall back to scanning header row cells
    if (absCol < 0 && table.hasHeaderRow) {
      const headerRow = table.range.startRow;
      const headerCells = (await this.ctx.computeBridge.getCellsInRangeYrs(
        this.sheetId,
        headerRow,
        table.range.startCol,
        headerRow,
        table.range.endCol,
      )) as Array<{ row: number; col: number; value?: unknown }>;
      for (const cell of headerCells) {
        const v = cell.value;
        // getCellsInRangeYrs returns Rust CellValue as {type:"text",value:"..."} objects
        const text =
          typeof v === 'string'
            ? v
            : v && typeof v === 'object' && 'value' in v
              ? String((v as Record<string, unknown>).value)
              : String(v ?? '');
        if (text === columnName) {
          absCol = cell.col;
          break;
        }
      }
    }

    if (absCol < 0) return [];

    // 4. Compute data row range (skip header, skip totals)
    const dataStartRow = table.range.startRow + (table.hasHeaderRow ? 1 : 0);
    const dataEndRow = table.range.endRow - (table.hasTotalsRow ? 1 : 0);
    if (dataStartRow > dataEndRow) return [];

    // 5. Read column data from Yrs
    const cellsJson = (await this.ctx.computeBridge.getCellsInRangeYrs(
      this.sheetId,
      dataStartRow,
      absCol,
      dataEndRow,
      absCol,
    )) as Array<{ row: number; col: number; value?: unknown }>;
    const columnData: CellValue[] = [];
    for (let r = dataStartRow; r <= dataEndRow; r++) {
      const cell = cellsJson.find((c: { row: number }) => c.row === r);
      columnData.push(extractCellValue(cell?.value));
    }

    // 6. Build slicer items from column data
    const selectedSet = new Set(stored.selectedValues.map((v: CellValue) => String(v ?? '')));
    const hasSelection = selectedSet.size > 0 && !(selectedSet.size === 1 && selectedSet.has(''));

    // Collect unique values with counts
    const valueCounts = new Map<string, { value: CellValue; count: number }>();
    for (const v of columnData) {
      const key = String(v ?? '');
      if (key === '') continue; // skip blanks
      const existing = valueCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        valueCounts.set(key, { value: v, count: 1 });
      }
    }

    // Sort ascending by default
    const sortedKeys = [...valueCounts.keys()].sort((a, b) => a.localeCompare(b));

    return sortedKeys.map((key) => {
      const entry = valueCounts.get(key)!;
      return {
        value: entry.value,
        selected: hasSelection ? selectedSet.has(key) : false,
        count: entry.count,
      };
    });
  }

  async getItem(slicerId: string, key: CellValue): Promise<SlicerItem> {
    const item = await this.getItemOrNullObject(slicerId, key);
    if (!item) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Slicer item with key "${String(key)}" not found in slicer "${slicerId}"`,
      );
    }
    return item;
  }

  async getItemOrNullObject(slicerId: string, key: CellValue): Promise<SlicerItem | null> {
    validateSlicerId(slicerId, 'getItem');
    const items = await this.getItems(slicerId);
    const keyStr = String(key ?? '');
    return items.find((item) => String(item.value ?? '') === keyStr) ?? null;
  }

  async setSelection(slicerId: string, selectedItems: CellValue[]): Promise<void> {
    validateSlicerId(slicerId, 'setSelection');
    await assertSlicerFilteringAllowed(this.ctx, this.sheetId, 'slicers.setSelection', slicerId);
    // Clear existing selection first, then toggle each desired item
    await this.ctx.computeBridge.clearSlicerSelection(this.sheetId, slicerId);
    for (const item of selectedItems) {
      await this.ctx.computeBridge.toggleSlicerItem(this.sheetId, slicerId, item);
    }

    // Propagate selection to table autofilter
    await this.propagateToAutofilter(slicerId, selectedItems);
  }

  async clearSelection(slicerId: string): Promise<void> {
    validateSlicerId(slicerId, 'clearSlicerSelection');
    await assertSlicerFilteringAllowed(this.ctx, this.sheetId, 'slicers.clearSelection', slicerId);
    await this.ctx.computeBridge.clearSlicerSelection(this.sheetId, slicerId);

    // Propagate clear to table autofilter
    await this.propagateToAutofilter(slicerId, []);
  }

  /**
   * Propagate slicer selection to the table's autofilter state.
   * Mirrors the pattern from domain/slicers/selection.ts setSlicerSelection.
   */
  private async propagateToAutofilter(
    slicerId: string,
    selectedValues: CellValue[],
  ): Promise<void> {
    const stored = await this.ctx.computeBridge.getSlicerState(this.sheetId, slicerId);
    if (!stored || stored.source.type !== 'table') return;

    const tableId = stored.source.tableId;
    const bridgeTable = await this.ctx.computeBridge.getTableByName(tableId);
    const table = bridgeTable ?? (await getTable(this.ctx, tableId));
    if (!table) return;

    // Get or create filter for the table
    const tableSheetId = toSheetId(table.sheetId);
    let filter = await Filters.getTableFilter(this.ctx, tableSheetId, table.id);
    if (!filter) {
      if (await getActiveProtectionOptions(this.ctx, tableSheetId)) {
        throw new KernelError(
          'API_PROTECTED_SHEET',
          'Sheet protection requires an existing table AutoFilter for slicer filtering',
          {
            context: {
              internalCode: 'API_PROTECTED_SHEET',
              operation: 'slicers.setSelection',
              tableName: table.name,
              reason:
                'Sheet protection requires an existing table AutoFilter for slicer filtering.',
            },
          },
        );
      }
      filter = await Filters.createFilter(
        this.ctx,
        tableSheetId,
        table.range,
        'tableFilter',
        'user',
        table.id,
      );
    }

    const sourceColumn = stored.source.columnCellId;
    const column = table.columns.find((c) => c.id === sourceColumn || c.name === sourceColumn);
    if (!column) return;
    const absCol = table.range.startCol + column.index;

    if (selectedValues.length === 0) {
      // Clear filter (show all)
      await this.ctx.computeBridge.clearColumnFilter(tableSheetId, filter.id, absCol);
    } else {
      // Set filter to show only selected values
      await this.ctx.computeBridge.setColumnFilter(
        tableSheetId,
        filter.id,
        absCol,
        columnFilterCriteriaToCompute({
          type: 'value',
          values: selectedValues,
        }),
      );
    }

    // Apply the filter to update row visibility
    await Filters.applyFilter(this.ctx, tableSheetId, filter.id);
  }

  async duplicate(slicerId: string, offset?: { x?: number; y?: number }): Promise<string> {
    validateSlicerId(slicerId, 'duplicateSlicer');
    await assertSlicerObjectTopologyAllowed(this.ctx, this.sheetId, 'slicers.duplicate', slicerId);
    const existing = await this.ctx.computeBridge.getSlicerState(this.sheetId, slicerId);
    if (!existing) {
      throw new KernelError('COMPUTE_ERROR', `Slicer "${slicerId}" not found`);
    }
    const xOffsetPx = offset?.x ?? 20;
    const yOffsetPx = offset?.y ?? 20;
    const existingAnchor = existing.position ?? defaultAnchor();
    const newPosition: FloatingObjectAnchor = {
      ...existingAnchor,
      anchorColOffsetEmu: existingAnchor.anchorColOffsetEmu + Math.round(xOffsetPx * EMU_PER_PX),
      anchorRowOffsetEmu: existingAnchor.anchorRowOffsetEmu + Math.round(yOffsetPx * EMU_PER_PX),
    };
    const result = await this.ctx.computeBridge.createSlicer(this.sheetId, {
      id: '',
      sheetId: '',
      source: existing.source,
      caption: existing.caption,
      name: existing.name,
      style: existing.style,
      position: newPosition,
      level: existing.level,
      zIndex: existing.zIndex,
      locked: existing.locked,
      showHeader: existing.showHeader,
      multiSelect: true,
      selectedValues: [],
    });
    return extractMutationData<StoredSlicer>(result)?.id ?? '';
  }

  async update(slicerId: string, updates: Partial<SlicerConfig>): Promise<void> {
    validateSlicerId(slicerId, 'updateSlicerConfig');
    await assertSlicerObjectEditAllowed(this.ctx, this.sheetId, 'slicers.update', slicerId);

    // Validate name uniqueness if name is being changed.
    if (updates.name !== undefined) {
      await this.validateNameUnique(updates.name, slicerId);
    }

    // Map SlicerConfig fields to StoredSlicerUpdate fields for the bridge.
    const bridgeUpdate: StoredSlicerUpdate = {};
    if (updates.caption !== undefined) bridgeUpdate.caption = updates.caption;
    if (updates.name !== undefined) bridgeUpdate.name = updates.name;
    if (updates.style !== undefined) bridgeUpdate.style = updates.style;
    if (updates.position !== undefined) {
      bridgeUpdate.position = pixelRectToAnchor(updates.position);
    }
    if (updates.showHeader !== undefined) bridgeUpdate.showHeader = updates.showHeader;
    await this.ctx.computeBridge.updateSlicerConfig(this.sheetId, slicerId, bridgeUpdate);
  }

  /**
   * Get slicer items for a pivot slicer by querying the pivot compute engine directly.
   * Returns SlicerItem[] shaped for the public API (value, selected, count).
   */
  private async getPivotSlicerItems(stored: StoredSlicer): Promise<SlicerItem[]> {
    if (stored.source.type !== 'pivot') return [];
    const { pivotId, fieldName } = stored.source;

    // Get all field items from the pivot compute engine
    const allFieldItems = await this.ctx.computeBridge.pivotGetAllItems(
      this.sheetId,
      pivotId,
      null, // no expansion state needed for slicer items
    );

    // Find the field matching the slicer's source field name
    const fieldItems = allFieldItems.find((fi) => fi.fieldName === fieldName);
    if (!fieldItems) return [];

    // Build selected-value set from stored selection
    const selectedSet = new Set(stored.selectedValues.map((v: CellValue) => String(v ?? '')));
    const hasSelection = selectedSet.size > 0 && !(selectedSet.size === 1 && selectedSet.has(''));

    // Map PivotItemInfo to SlicerItem, excluding subtotals/grand totals
    return fieldItems.items
      .filter((item) => !item.isSubtotal && !item.isGrandTotal)
      .map((item) => ({
        value: item.value,
        selected: hasSelection ? selectedSet.has(String(item.value ?? '')) : false,
        count: undefined,
      }));
  }

  /**
   * Check whether a slicer is connected to its underlying data source.
   * - Table slicer: connected if the table and column exist.
   * - Pivot slicer: connected if the pivot table and field still exist.
   */
  private async checkSlicerConnectivity(stored: StoredSlicer): Promise<boolean> {
    if (stored.source.type === 'table') {
      const table = await this.ctx.computeBridge.getTableByName(stored.source.tableId);
      if (!table) return false;
      // Verify the column still exists in the table
      const columnName = stored.source.columnCellId;
      if (table.columns.length > 0) {
        return table.columns.some((c) => c.name === columnName || c.id === columnName);
      }
      // If no column metadata, assume connected if table exists
      return true;
    }

    if (stored.source.type === 'pivot') {
      const { pivotId, fieldName } = stored.source;
      const pivotConfig = await this.ctx.computeBridge.pivotGet(this.sheetId, pivotId);
      if (!pivotConfig) return false;
      // Check that the field still exists in the pivot configuration
      return pivotConfig.fields.some((f) => f.name === fieldName);
    }

    return false;
  }

  async getState(slicerId: string): Promise<SlicerState> {
    const state = await this.ctx.computeBridge.getSlicerState(this.sheetId, slicerId);
    if (!state) {
      throw new KernelError('COMPUTE_ERROR', `Slicer "${slicerId}" not found`);
    }

    // Get real items based on slicer source type
    const items =
      state.source.type === 'pivot'
        ? await this.getPivotSlicerItems(state)
        : await this.getItems(slicerId);

    // Check real connectivity
    const isConnected = await this.checkSlicerConnectivity(state);

    return {
      items,
      isConnected,
      selectedValues: state.selectedValues,
      periods: undefined,
    };
  }
}
