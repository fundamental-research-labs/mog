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
  Table as CanonicalTable,
} from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';
import * as Filters from '../../domain/sorting/filters';
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
    if (obj.type === 'number' && typeof obj.value === 'number') return obj.value;
    if (obj.type === 'boolean' && typeof obj.value === 'boolean') return obj.value;
    if (obj.type === 'blank' || obj.type === 'empty' || obj.type === 'null') return null;
    if (obj.type === 'error') return null;
    if (
      'value' in obj &&
      (typeof obj.value === 'string' ||
        typeof obj.value === 'number' ||
        typeof obj.value === 'boolean')
    ) {
      return obj.value;
    }
  }
  return null;
}

function validateSlicerId(slicerId: string, operation: string): void {
  if (typeof slicerId !== 'string' || slicerId.length === 0) {
    throw new KernelError('COMPUTE_ERROR', `${operation}: slicerId must be a non-empty string`);
  }
}

type ResolvedTableSlicerColumn = {
  columnId: string;
  absCol: number;
  tableColumnIndex: number;
  columnName: string;
};

type StoredTableSlicerSource = Extract<StoredSlicer['source'], { type: 'table' }>;

type ResolvedTableSlicerSource = {
  table: CanonicalTable;
  tableSheetId: SheetId;
  tableName: string;
  columnName: string;
  column: ResolvedTableSlicerColumn | null;
};

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
    const sourceInput = config.source ?? {
      type: 'table' as const,
      tableId: config.tableName ?? '',
      columnCellId: config.columnName ?? '',
    };
    let source: StoredSlicer['source'] = sourceInput;
    let tableColumnIndex: number | undefined;
    let publicTableName = '';
    let publicColumnName = '';
    if (sourceInput.type === 'table') {
      const table = config.source
        ? await this.resolveTableForSlicerSource(sourceInput.tableId)
        : await this.resolvePublicTableForSlicerConfig(sourceInput.tableId);
      if (!table) {
        throw new KernelError('COMPUTE_ERROR', `Table not found: ${sourceInput.tableId}`);
      }
      const resolvedColumn = await this.resolveTableSlicerColumn(table, sourceInput.columnCellId, {
        allowColumnName: !config.source,
      });
      if (!resolvedColumn) {
        throw new KernelError(
          'COMPUTE_ERROR',
          `Column not found in table "${table.name}": ${sourceInput.columnCellId}`,
        );
      }
      source = {
        type: 'table',
        tableId: table.id,
        columnCellId: resolvedColumn.columnId,
      };
      tableColumnIndex = resolvedColumn.tableColumnIndex;
      publicTableName = this.publicTableName(table, sourceInput.tableId);
      publicColumnName = resolvedColumn.columnName;
    }
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
      cacheName:
        source.type === 'table' ? `Slicer_${publicColumnName || caption || 'Slicer'}` : undefined,
      caption,
      name: config.name,
      style: config.style ?? defaultStyle,
      tableColumnIndex,
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
      tableName: publicTableName,
      columnName: publicColumnName,
      source,
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
    return Promise.all(slicers.map((s) => this.projectSlicerInfo(s)));
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
    const sourceProjection =
      state.source.type === 'table'
        ? await this.resolvePublicTableSource(state.source)
        : { tableName: '', columnName: '' };
    return {
      id: slicerId,
      name: state.name ?? state.caption,
      caption: state.caption,
      tableName: sourceProjection.tableName,
      columnName: sourceProjection.columnName,
      source: state.source,
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

    // 2. Resolve the slicer's stable/public table + column source.
    const resolvedSource = await this.resolveTableSlicerSource(stored.source);
    if (!resolvedSource?.column) return [];
    const { table, tableSheetId, column: resolvedColumn } = resolvedSource;

    // 3. Compute data row range (skip header, skip totals)
    const dataStartRow = table.range.startRow + (table.hasHeaderRow ? 1 : 0);
    const dataEndRow = table.range.endRow - (table.hasTotalsRow ? 1 : 0);
    if (dataStartRow > dataEndRow) return [];

    // 4. Read column data from Yrs
    const cellsJson = (await this.ctx.computeBridge.getCellsInRangeYrs(
      tableSheetId,
      dataStartRow,
      resolvedColumn.absCol,
      dataEndRow,
      resolvedColumn.absCol,
    )) as Array<{ row: number; col: number; value?: unknown }>;
    const columnData: CellValue[] = [];
    for (let r = dataStartRow; r <= dataEndRow; r++) {
      const cell = cellsJson.find((c: { row: number }) => c.row === r);
      columnData.push(extractCellValue(cell?.value));
    }

    // 5. Build slicer items from column data
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

    const resolvedSource = await this.resolveTableSlicerSource(stored.source);
    if (!resolvedSource?.column) return;
    const { table, tableSheetId, column: resolvedColumn } = resolvedSource;

    // Get or create filter for the table
    await this.ctx.awaitMaterialized?.('allSheets');
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

    if (selectedValues.length === 0) {
      // Clear filter (show all)
      await this.ctx.computeBridge.clearColumnFilter(
        tableSheetId,
        filter.id,
        resolvedColumn.absCol,
      );
    } else {
      // Set filter to show only selected values
      await this.ctx.computeBridge.setColumnFilter(
        tableSheetId,
        filter.id,
        resolvedColumn.absCol,
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
      cacheName: existing.cacheName,
      cacheUid: existing.cacheUid,
      caption: existing.caption,
      name: existing.name,
      style: existing.style,
      tableColumnIndex: existing.tableColumnIndex,
      pivotCacheId: existing.pivotCacheId,
      pivotTableTabId: existing.pivotTableTabId,
      pivotTabularItems: existing.pivotTabularItems,
      rowHeight: existing.rowHeight,
      position: newPosition,
      level: existing.level,
      uid: existing.uid,
      extLstXml: existing.extLstXml,
      cacheExtLstXml: existing.cacheExtLstXml,
      anchorObjectId: existing.anchorObjectId,
      anchorMacroName: existing.anchorMacroName,
      anchorNvExtLstXml: existing.anchorNvExtLstXml,
      zIndex: existing.zIndex,
      locked: existing.locked,
      showHeader: existing.showHeader,
      startItem: existing.startItem,
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
      const resolved = await this.resolveTableSlicerSource(stored.source);
      return resolved?.column != null;
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

  private async projectSlicerInfo(stored: StoredSlicer): Promise<SlicerInfo> {
    const sourceProjection =
      stored.source.type === 'table'
        ? await this.resolvePublicTableSource(stored.source)
        : { tableName: '', columnName: '' };
    return {
      id: stored.id,
      name: stored.name ?? stored.caption,
      caption: stored.caption,
      tableName: sourceProjection.tableName,
      columnName: sourceProjection.columnName,
      source: stored.source,
    };
  }

  private async resolvePublicTableSource(source: StoredTableSlicerSource): Promise<{
    tableName: string;
    columnName: string;
  }> {
    const resolved = await this.resolveTableSlicerSource(source);
    return {
      tableName: resolved?.tableName ?? source.tableId,
      columnName: resolved?.columnName ?? source.columnCellId,
    };
  }

  private async resolveTableSlicerSource(
    source: StoredTableSlicerSource,
  ): Promise<ResolvedTableSlicerSource | null> {
    const table = await this.resolveTableForSlicerSource(source.tableId);
    if (!table) return null;

    const column = await this.resolveTableSlicerColumn(table, source.columnCellId);
    return {
      table,
      tableSheetId: this.sheetIdForTable(table),
      tableName: this.publicTableName(table, source.tableId),
      columnName: column?.columnName ?? source.columnCellId,
      column,
    };
  }

  private async resolveTableForSlicerSource(tableRef: string): Promise<CanonicalTable | null> {
    const sheetTables = await this.ctx.computeBridge.getAllTablesInSheet(this.sheetId);
    const sheetMatch = this.findTableByStableId(sheetTables, tableRef);
    if (sheetMatch) return sheetMatch;

    const workbookTables = await this.ctx.computeBridge.getAllTablesWorkbook();
    const workbookMatch = this.findTableByStableId(
      workbookTables.map((entry) => entry.table),
      tableRef,
    );
    return workbookMatch;
  }

  private async resolvePublicTableForSlicerConfig(
    tableRef: string,
  ): Promise<CanonicalTable | null> {
    const byName = await this.ctx.computeBridge.getTableByName(tableRef);
    if (byName) return byName;
    return this.resolveTableForSlicerSource(tableRef);
  }

  private findTableByStableId(tables: CanonicalTable[], tableId: string): CanonicalTable | null {
    return tables.find((table) => table.id === tableId) ?? null;
  }

  private publicTableName(table: CanonicalTable, fallback: string): string {
    return table.name || table.displayName || fallback;
  }

  private sheetIdForTable(table: CanonicalTable): SheetId {
    return table.sheetId ? toSheetId(table.sheetId) : this.sheetId;
  }

  private async resolveTableSlicerColumn(
    table: CanonicalTable,
    sourceColumnRef: string,
    options: { allowColumnName?: boolean } = {},
  ): Promise<ResolvedTableSlicerColumn | null> {
    const directColumn =
      table.columns.find((c) => c.id === sourceColumnRef) ??
      (options.allowColumnName === true
        ? table.columns.find((c) => c.name === sourceColumnRef)
        : undefined);
    if (directColumn) {
      return {
        columnId: directColumn.id,
        absCol: table.range.startCol + directColumn.index,
        tableColumnIndex: directColumn.index,
        columnName: directColumn.name,
      };
    }

    const headerPosition = await this.ctx.computeBridge.getCellPosition(
      this.sheetIdForTable(table),
      sourceColumnRef,
    );
    if (
      headerPosition &&
      headerPosition.row === table.range.startRow &&
      headerPosition.col >= table.range.startCol &&
      headerPosition.col <= table.range.endCol
    ) {
      const columnIndex = headerPosition.col - table.range.startCol;
      const column =
        table.columns.find((candidate) => candidate.index === columnIndex) ??
        table.columns[columnIndex] ??
        null;
      if (column) {
        return {
          columnId: column.id,
          absCol: headerPosition.col,
          tableColumnIndex: column.index ?? columnIndex,
          columnName: column.name,
        };
      }
    }

    return null;
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
