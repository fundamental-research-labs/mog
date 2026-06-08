/**
 * WorksheetPivotsImpl — facade for the WorksheetPivots sub-API.
 *
 * The worksheet instance owns sheetId and delegates behavior to focused
 * worksheet pivot modules.
 */
import type {
  PivotTableConfig as ApiPivotTableConfig,
  PivotRefreshReceipt,
  PivotTableHandle,
  PivotTableInfo,
  PivotQueryResult,
  SheetId,
  Workbook,
  WorkbookInternal,
  WorksheetPivots,
  ImportedPivotViewRecord,
} from '@mog-sdk/contracts/api';
import { type CellRange, type CellValue, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  AggregateFunction,
  CalculatedField,
  DataSourceType,
  PivotDataHierarchyInfo,
  PivotExpansionState,
  PivotFieldArea,
  PivotFieldItems,
  PivotFilter,
  PivotItemLocation,
  PivotKernelMutationReceipt,
  SortOrder,
  PivotTableConfig as DataPivotTableConfig,
  ShowValuesAsConfig,
  PivotTableResult,
  PivotTableLayout,
  PivotTableStyle,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../../context';
import { KernelError, createPivotStaleHandleError } from '../../../errors';
import { rangeToA1, toA1 } from '../../internal/utils';
import { buildPivotTableHandle, type PivotHandleSnapshotRegistry } from './handle';
import { dataConfigToApiConfig } from './config-conversion';
import {
  convertSimpleToDataConfig,
  isSimplePivotConfig,
  updatePivotDataSource,
  type PivotCreateDataConfig,
} from '../../../domain/pivots/data-source';
import {
  configWithRequiredMetadata,
  makePlacementId,
  pivotPlacementId,
} from '../../../domain/pivots/identifiers';
import { findPivotByName, requirePivot } from '../../../domain/pivots/lookup';
import {
  placementFieldName,
  placementReadout,
  placementId,
  resolvePlacement,
} from '../../../domain/pivots/placements';
import { queryPivotByName } from '../../../domain/pivots/query';
import {
  addPivotCalculatedFieldByName,
  addPivotCalculatedFieldToId,
  removePivotCalculatedFieldByName,
  updatePivotCalculatedFieldByName,
} from '../../../domain/pivots/calculated-fields';
import {
  getPivotDataHierarchyAtCell,
  getPivotItemsAtCell,
} from '../../../domain/pivots/cell-provenance';
import {
  setPivotFilterByName,
  removePivotFilterByName,
  setPivotItemVisibilityByName,
} from '../../../domain/pivots/filters';
import {
  addPivotField,
  movePivotField,
  removePivotField,
  resetPivotField,
  setPivotAggregateFunction,
  setPivotShowValuesAs,
  setPivotSortOrder,
} from '../../../domain/pivots/field-mutations';
import {
  getPivotAllowMultipleFiltersPerField,
  getPivotAutoFormat,
  getPivotEnableMultipleFilterItems,
  getPivotPreserveFormatting,
  setPivotAllowMultipleFiltersPerField,
  setPivotAutoFormat,
  setPivotEnableMultipleFilterItems,
  setPivotPreserveFormatting,
} from '../../../domain/pivots/formatting-options';
import { setPivotLayoutByName, setPivotStyleByName } from '../../../domain/pivots/layout-style';
import {
  getPivotColumnLabelRangeByName,
  getPivotDataBodyRangeByName,
  getPivotFilterAxisRangeByName,
  getPivotRangeByName,
  getPivotRangeForId,
  getPivotRowLabelRangeByName,
} from '../../../domain/pivots/ranges';
import type { HandleLiveness } from '../../lifecycle/handle-liveness';

type PivotSnapshotEntry =
  | { readonly status: 'live'; readonly config: DataPivotTableConfig }
  | { readonly status: 'deleted' };

export class WorksheetPivotsImpl implements WorksheetPivots {
  private readonly pivotSnapshots = new Map<string, PivotSnapshotEntry>();
  private readonly snapshots: PivotHandleSnapshotRegistry = {
    get: (pivotId) => {
      const entry = this.pivotSnapshots.get(pivotId);
      return entry?.status === 'live' ? entry.config : undefined;
    },
    set: (config) => {
      this.cachePivot(config);
    },
    markDeleted: (pivotId) => {
      this.pivotSnapshots.set(pivotId, { status: 'deleted' });
    },
    require: (pivotId, operation) => {
      this._assertLive(operation);
      const entry = this.pivotSnapshots.get(pivotId);
      if (entry?.status === 'live') {
        return entry.config;
      }
      throw createPivotStaleHandleError({ operation, sheetId: this.sheetId, pivotId });
    },
    refresh: async (pivotId, operation) => {
      this._assertLive(operation);
      const pivot = await this.ctx.pivot.getPivot(this.sheetId, pivotId);
      if (!pivot) {
        this.pivotSnapshots.set(pivotId, { status: 'deleted' });
        throw createPivotStaleHandleError({ operation, sheetId: this.sheetId, pivotId });
      }
      return this.cachePivot(pivot);
    },
  };

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
    private readonly workbook?: Workbook | null,
    private readonly liveness?: HandleLiveness,
  ) {}

  private _ensureWritable(op: string): void {
    this._assertLive(op);
    this.ctx.writeGate.assertWritable(op);
  }

  private _assertLive(op: string): void {
    this.liveness?.assertLive(`worksheet.pivots.${op}`);
  }

  private pivotId(config: DataPivotTableConfig): string {
    return config.id ?? config.name;
  }

  private cachePivot(config: DataPivotTableConfig): DataPivotTableConfig {
    this.pivotSnapshots.set(this.pivotId(config), { status: 'live', config });
    return config;
  }

  private markPivotDeleted(pivotId: string): void {
    this.pivotSnapshots.set(pivotId, { status: 'deleted' });
  }

  // ---------------------------------------------------------------------------
  // Name → ID resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve a pivot table name to its ID.
   * Throws KernelError if not found.
   */
  private async resolveNameToId(name: string, operation: string): Promise<string> {
    this._assertLive(operation);
    const pivot = await findPivotByName(this.ctx, this.sheetId, name);
    if (!pivot) {
      throw new KernelError('COMPUTE_ERROR', `${operation}: Pivot table "${name}" not found`);
    }
    return pivot.id ?? pivot.name;
  }

  // ===========================================================================
  // CRUD
  // ===========================================================================

  /** Monotonic counter to ensure unique pivot IDs within the same millisecond. */
  private static _idCounter = 0;

  async add(config: PivotCreateDataConfig | ApiPivotTableConfig): Promise<DataPivotTableConfig> {
    this._ensureWritable('pivots.add');
    let dataConfig: PivotCreateDataConfig;

    if (isSimplePivotConfig(config as Record<string, unknown>)) {
      // Convert simple/ergonomic config to wire format
      const sheetName = await this.ctx.computeBridge.getSheetName(this.sheetId);
      dataConfig = await convertSimpleToDataConfig(
        this.ctx,
        config as ApiPivotTableConfig,
        sheetName ?? '',
        makePlacementId,
      );
    } else {
      // Rust-side validation (in pivot_create/pivot_create_with_sheet) catches
      // ALL missing/wrong fields in one error — no TS-side pre-validation needed.
      dataConfig = config as PivotCreateDataConfig;
    }

    // Generate an ID if not provided — the Rust bridge requires `id` to be present.
    const configWithId = configWithRequiredMetadata(
      dataConfig,
      `pivot-${Date.now()}-${WorksheetPivotsImpl._idCounter++}`,
    );
    return this.cachePivot(await this.ctx.pivot.createPivot(configWithId));
  }

  async addWithSheet(
    sheetName: string,
    config: PivotCreateDataConfig | ApiPivotTableConfig,
  ): Promise<{ sheetId: SheetId; config: DataPivotTableConfig }> {
    let dataConfig: PivotCreateDataConfig;

    if (isSimplePivotConfig(config as Record<string, unknown>)) {
      // Convert simple/ergonomic config to wire format
      // For addWithSheet, the output sheet will be created with the given name
      dataConfig = await convertSimpleToDataConfig(
        this.ctx,
        config as ApiPivotTableConfig,
        sheetName,
        makePlacementId,
      );
    } else {
      // Rust-side validation (in pivot_create_with_sheet) catches
      // ALL missing/wrong fields in one error — no TS-side pre-validation needed.
      dataConfig = config as PivotCreateDataConfig;
    }

    const configWithId = configWithRequiredMetadata(
      dataConfig,
      `pivot-${Date.now()}-${WorksheetPivotsImpl._idCounter++}`,
    );
    const result = await this.ctx.pivot.createPivotWithSheet(sheetName, configWithId);
    // Sync cached sheet metadata so wb.sheetNames reflects the newly created sheet
    if (this.workbook) {
      await (this.workbook as WorkbookInternal).refreshSheetMetadata();
    }
    return { sheetId: toSheetId(result.sheetId), config: this.cachePivot(result.config) };
  }

  async getAll(): Promise<DataPivotTableConfig[]> {
    this._assertLive('getAll');
    try {
      const pivots = await this.ctx.pivot.getAllPivots(this.sheetId);
      pivots.forEach((pivot) => this.cachePivot(pivot));
      return pivots;
    } catch {
      return [];
    }
  }

  async getImportedViewRecords(): Promise<ImportedPivotViewRecord[]> {
    this._assertLive('getImportedViewRecords');
    try {
      return await this.ctx.pivot.getImportedPivotViewRecords(this.sheetId);
    } catch {
      return [];
    }
  }

  async rename(name: string, newName: string): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'rename');
    const updated = await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { name: newName },
      { reason: 'renamed', refreshPolicy: 'refreshAndMaterialize' },
    );
    if (updated) {
      this.cachePivot(updated);
    }
  }

  async remove(name: string): Promise<void> {
    this._assertLive('remove');
    const pivot = await findPivotByName(this.ctx, this.sheetId, name);
    if (!pivot) {
      throw new KernelError('COMPUTE_ERROR', `Pivot table "${name}" not found`);
    }
    if (!pivot.id) {
      throw new KernelError('COMPUTE_ERROR', 'Pivot ID is required');
    }
    await this.ctx.pivot.deletePivot(this.sheetId, pivot.id);
    this.markPivotDeleted(pivot.id);
  }

  async clear(): Promise<void> {
    this._assertLive('clear');
    const pivots = await this.list();
    for (const pivot of pivots) {
      await this.remove(pivot.name);
    }
  }

  async list(): Promise<PivotTableInfo[]> {
    this._assertLive('list');
    let pivots: DataPivotTableConfig[];
    try {
      pivots = await this.ctx.pivot.getAllPivots(this.sheetId);
    } catch {
      return [];
    }
    pivots.forEach((pivot) => this.cachePivot(pivot));
    return Promise.all(pivots.map((p) => this.infoForPivot(p)));
  }

  async get(pivotRef: string | DataPivotTableConfig): Promise<PivotTableHandle | null> {
    this._assertLive('get');
    const pivot =
      typeof pivotRef === 'string'
        ? await findPivotByName(this.ctx, this.sheetId, pivotRef)
        : await this.ctx.pivot.getPivot(this.sheetId, pivotRef.id);
    if (!pivot) {
      return null;
    }
    this.cachePivot(pivot);
    return this.buildHandle(pivot, pivot.sourceSheetName);
  }

  async getInfo(name: string): Promise<PivotTableInfo | null> {
    this._assertLive('getInfo');
    const pivot = await findPivotByName(this.ctx, this.sheetId, name);
    if (!pivot) {
      return null;
    }
    this.cachePivot(pivot);
    return this.infoForPivot(pivot);
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== null;
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async listPlacements(name: string): Promise<any[]> {
    const pivotId = await this.resolveNameToId(name, 'listPlacements');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'listPlacements');
    return config.placements.map((placement) => placementReadout(config, placement));
  }

  async findPlacementsByField(name: string, fieldIdOrName: string): Promise<any[]> {
    const pivotId = await this.resolveNameToId(name, 'findPlacementsByField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'findPlacementsByField');
    return config.placements
      .filter((placement) => {
        const fieldName = placementFieldName(config, placement);
        return placement.fieldId === fieldIdOrName || fieldName === fieldIdOrName;
      })
      .map((placement) => placementReadout(config, placement));
  }

  async addField(
    name: string,
    fieldId: string,
    area: PivotFieldArea,
    options?: {
      position?: number;
      aggregateFunction?: AggregateFunction;
      sortOrder?: SortOrder;
      displayName?: string;
      showValuesAs?: ShowValuesAsConfig;
    },
  ): Promise<void> {
    await addPivotField({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
      area,
      placementOptions: options,
    });
  }

  async removeField(name: string, fieldId: string, area: PivotFieldArea): Promise<void> {
    await removePivotField({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
      area,
    });
  }

  async moveField(
    name: string,
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    toPosition: number,
  ): Promise<void> {
    await movePivotField({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
      fromArea,
      toArea,
      toPosition,
    });
  }

  // ===========================================================================
  // Field Configuration
  // ===========================================================================

  setAggregateFunction(
    pivot: string,
    fieldOrPlacement: string,
    aggregateFunction: AggregateFunction,
  ): Promise<PivotKernelMutationReceipt>;
  async setAggregateFunction(
    pivotOrName: string,
    placementOrFieldId: string,
    aggregateFunction: AggregateFunction,
  ): Promise<PivotKernelMutationReceipt> {
    return setPivotAggregateFunction({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: pivotOrName,
      placementOrFieldId,
      aggregateFunction,
    });
  }

  setShowValuesAs(
    pivot: string,
    fieldOrPlacement: string,
    showValuesAs: ShowValuesAsConfig | null,
  ): Promise<PivotKernelMutationReceipt>;
  async setShowValuesAs(
    pivotOrName: string,
    placementOrFieldId: string,
    showValuesAs: ShowValuesAsConfig | null,
  ): Promise<PivotKernelMutationReceipt> {
    return setPivotShowValuesAs({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: pivotOrName,
      placementOrFieldId,
      showValuesAs,
    });
  }

  setSortOrder(
    pivot: string,
    fieldOrPlacement: string,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt>;
  async setSortOrder(
    pivotOrName: string,
    placementOrFieldId: string,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt> {
    return setPivotSortOrder({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: pivotOrName,
      placementOrFieldId,
      sortOrder,
    });
  }

  async setFilter(
    name: string,
    fieldId: string,
    filter: Omit<PivotFilter, 'fieldId'>,
  ): Promise<void> {
    await setPivotFilterByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
      filter,
    });
  }

  async removeFilter(name: string, fieldId: string): Promise<void> {
    await removePivotFilterByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
    });
  }

  async resetField(name: string, fieldId: string): Promise<void> {
    await resetPivotField({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
    });
  }

  // ===========================================================================
  // Layout and Style
  // ===========================================================================

  async setLayout(name: string, layout: Partial<PivotTableLayout>): Promise<any> {
    return setPivotLayoutByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      layout,
    });
  }

  async setStyle(name: string, style: Partial<PivotTableStyle>): Promise<void> {
    await setPivotStyleByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      style,
    });
  }

  // ===========================================================================
  // Computation
  // ===========================================================================

  async detectFields(
    sourceSheetId: SheetId,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<any[]> {
    return await this.ctx.pivot.detectFields(sourceSheetId, range);
  }

  async compute(name: string, forceRefresh?: boolean): Promise<PivotTableResult | null> {
    const pivotId = await this.resolveNameToId(name, 'compute');
    return await this.ctx.pivot.compute(this.sheetId, pivotId, forceRefresh);
  }

  async refresh(name: string): Promise<PivotRefreshReceipt> {
    const pivotId = await this.resolveNameToId(name, 'refresh');
    return this._refreshByPivotId(pivotId);
  }

  async refreshAll(): Promise<void> {
    let pivots: DataPivotTableConfig[];
    try {
      pivots = await this.ctx.pivot.getAllPivots(this.sheetId);
    } catch {
      return;
    }
    await Promise.all(pivots.map((p) => this._refreshByPivotId(p.id ?? p.name)));
  }

  private async _refreshByPivotId(pivotId: string): Promise<PivotRefreshReceipt> {
    await this.ctx.pivot.refresh(this.sheetId, pivotId);
    return { kind: 'pivotRefresh', pivotId };
  }

  async getDrillDownData(name: string, rowKey: string, columnKey: string): Promise<CellValue[][]> {
    const pivotId = await this.resolveNameToId(name, 'getDrillDownData');
    return await this.ctx.pivot.getDrillDownData(this.sheetId, pivotId, rowKey, columnKey);
  }

  async queryPivot(
    pivotName: string,
    filters?: Record<string, CellValue | CellValue[]>,
  ): Promise<PivotQueryResult | null> {
    return queryPivotByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName,
      filters,
    });
  }

  // ===========================================================================
  // Pivot Items
  // ===========================================================================

  async getAllPivotItems(name: string): Promise<PivotFieldItems[]> {
    const pivotId = await this.resolveNameToId(name, 'getAllPivotItems');
    return await this.ctx.pivot.getAllPivotItems(this.sheetId, pivotId);
  }

  async setPivotItemVisibility(
    name: string,
    fieldId: string,
    visibleItems: Record<string, boolean>,
  ): Promise<void> {
    await setPivotItemVisibilityByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
      visibleItems,
    });
  }

  async setItemVisibility(
    name: string,
    fieldId: string,
    visibleItems: Record<string, boolean>,
  ): Promise<void> {
    await this.setPivotItemVisibility(name, fieldId, visibleItems);
  }

  // ===========================================================================
  // Expansion State (delegated to PivotExpansionStateProvider)
  // ===========================================================================

  async toggleExpanded(name: string, headerKey: string, isRow: boolean): Promise<boolean> {
    const pivotId = await this.resolveNameToId(name, 'toggleExpanded');
    const provider = this.ctx.pivotExpansionProvider;
    if (!provider) return true; // default: expanded
    return provider.toggleExpanded(pivotId, headerKey, isRow, this.sheetId);
  }

  async setAllExpanded(name: string, expanded: boolean): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setAllExpanded');
    this.ctx.pivotExpansionProvider?.setAllExpanded(pivotId, expanded);
  }

  async getExpansionState(name: string): Promise<PivotExpansionState> {
    const pivotId = await this.resolveNameToId(name, 'getExpansionState');
    return (
      this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
        expandedRows: {},
        expandedColumns: {},
      }
    );
  }

  // ===========================================================================
  // Data Source
  // ===========================================================================

  async getDataSourceType(name: string): Promise<DataSourceType> {
    // Currently all pivot tables are backed by cell ranges.
    // Future: detect table-backed pivots from config.
    await this.resolveNameToId(name, 'getDataSourceType');
    return 'range';
  }

  async setDataSource(name: string, dataSource: string): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setDataSource');
    const config =
      (await findPivotByName(this.ctx, this.sheetId, name)) ??
      (await requirePivot(this.ctx, this.sheetId, pivotId, 'setDataSource'));
    await this._setDataSourceByPivotId(pivotId, config, dataSource, name);
    const updated = await this.ctx.pivot.getPivot(this.sheetId, pivotId);
    if (updated) {
      this.cachePivot(updated);
    }
  }

  private async setDataSourceForHandle(pivotId: string, dataSource: string): Promise<void> {
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'setDataSource');
    await this._setDataSourceByPivotId(pivotId, config, dataSource, config.name ?? pivotId);
  }

  private async _setDataSourceByPivotId(
    pivotId: string,
    config: DataPivotTableConfig,
    dataSource: string,
    pivotName: string,
  ): Promise<void> {
    await updatePivotDataSource({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotId,
      config,
      dataSource,
      pivotName,
    });
  }

  // ===========================================================================
  // Formatting Options
  // ===========================================================================

  async getAllowMultipleFiltersPerField(name: string): Promise<boolean> {
    return getPivotAllowMultipleFiltersPerField({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async setAllowMultipleFiltersPerField(name: string, allow: boolean): Promise<void> {
    await setPivotAllowMultipleFiltersPerField({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      allow,
    });
  }

  async getAutoFormat(name: string): Promise<boolean> {
    return getPivotAutoFormat({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async setAutoFormat(name: string, autoFormat: boolean): Promise<void> {
    await setPivotAutoFormat({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      autoFormat,
    });
  }

  async getPreserveFormatting(name: string): Promise<boolean> {
    return getPivotPreserveFormatting({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async setPreserveFormatting(name: string, preserve: boolean): Promise<void> {
    await setPivotPreserveFormatting({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      preserve,
    });
  }

  // ===========================================================================
  // Cell Provenance (B2)
  // ===========================================================================

  async getDataHierarchy(
    name: string,
    row: number,
    col: number,
  ): Promise<PivotDataHierarchyInfo | null> {
    return getPivotDataHierarchyAtCell({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      row,
      col,
    });
  }

  async getPivotItems(
    name: string,
    axis: 'row' | 'column',
    row: number,
    col: number,
  ): Promise<PivotItemLocation[] | null> {
    return getPivotItemsAtCell({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      axis,
      row,
      col,
    });
  }

  // ===========================================================================
  // Multiple Filter Items (B7)
  // ===========================================================================

  async getEnableMultipleFilterItems(name: string, _fieldId: string): Promise<boolean> {
    return getPivotEnableMultipleFilterItems({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async setEnableMultipleFilterItems(
    name: string,
    _fieldId: string,
    enabled: boolean,
  ): Promise<void> {
    await setPivotEnableMultipleFilterItems({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      enabled,
    });
  }

  // ===========================================================================
  // Calculated Fields
  // ===========================================================================

  addCalculatedField(name: string, field: CalculatedField): Promise<void>;
  async addCalculatedField(name: string, field: CalculatedField): Promise<void> {
    await addPivotCalculatedFieldByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      field,
    });
  }

  removeCalculatedField(name: string, fieldId: string): Promise<void>;
  async removeCalculatedField(name: string, fieldId: string): Promise<void> {
    await removePivotCalculatedFieldByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
    });
  }

  updateCalculatedField(
    name: string,
    fieldId: string,
    updates: Partial<Pick<CalculatedField, 'name' | 'formula'>>,
  ): Promise<void>;
  async updateCalculatedField(
    name: string,
    fieldId: string,
    updates: Partial<Pick<CalculatedField, 'name' | 'formula'>>,
  ): Promise<void> {
    await updatePivotCalculatedFieldByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      fieldId,
      updates,
    });
  }

  // ===========================================================================
  // Sub-Range Access
  // ===========================================================================

  async getRange(name: string): Promise<CellRange | null> {
    return getPivotRangeByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async getDataBodyRange(name: string): Promise<CellRange | null> {
    return getPivotDataBodyRangeByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async getColumnLabelRange(name: string): Promise<CellRange | null> {
    return getPivotColumnLabelRangeByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async getRowLabelRange(name: string): Promise<CellRange | null> {
    return getPivotRowLabelRangeByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async getFilterAxisRange(name: string): Promise<CellRange | null> {
    return getPivotFilterAxisRangeByName({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildHandle(
    pivotConfig: DataPivotTableConfig,
    sourceSheetName: string | null,
  ): PivotTableHandle {
    return buildPivotTableHandle({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotConfig,
      sourceSheetName,
      toApiConfig: dataConfigToApiConfig,
      makePlacementId,
      pivotPlacementId,
      resolvePlacement,
      placementId,
      getRange: (pivotId) => getPivotRangeForId({ ctx: this.ctx, sheetId: this.sheetId, pivotId }),
      getCollectionInfo: (config) => this.infoForPivot(config),
      addCalculatedField: (pivotId, field) =>
        addPivotCalculatedFieldToId({ ctx: this.ctx, sheetId: this.sheetId, pivotId, field }),
      setDataSource: (pivotId, dataSource) => this.setDataSourceForHandle(pivotId, dataSource),
      snapshots: this.snapshots,
      liveness: this.liveness,
    });
  }

  private async infoForPivot(p: DataPivotTableConfig): Promise<PivotTableInfo> {
    const apiConfig = dataConfigToApiConfig(p, p.sourceSheetName);
    const location = p.outputLocation
      ? toA1(p.outputLocation.row, p.outputLocation.col)
      : undefined;
    const contentArea = await this.getContentAreaForPivot(this.pivotId(p));
    return {
      name: p.name ?? p.id,
      dataSource: apiConfig.dataSource,
      contentArea,
      filterArea: undefined,
      location,
      rowFields: apiConfig.rowFields,
      columnFields: apiConfig.columnFields,
      valueFields: apiConfig.valueFields,
      filterFields: apiConfig.filterFields,
    };
  }

  private async getContentAreaForPivot(pivotId: string): Promise<string> {
    const range = await getPivotRangeForId({ ctx: this.ctx, sheetId: this.sheetId, pivotId });
    return range ? rangeToA1(range) : '';
  }
}
