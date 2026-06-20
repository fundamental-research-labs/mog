import type {
  PivotTableConfig as ApiPivotTableConfig,
  PivotAddReceipt,
  PivotAddWithSheetReceipt,
  PivotComputeReceipt,
  PivotRefreshAllReceipt,
  PivotRefreshReceipt,
  PivotTableHandle,
  PivotTableInfo,
  PivotQueryReceipt,
  SheetId,
  WorksheetRange,
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
import { toWorksheetRangeOrNull } from '../public-ranges';
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
import {
  applyPivotClearReceipt,
  applyPivotRemoveReceipt,
  applyPivotRenameReceipt,
  buildPivotAddReceipt,
  buildPivotAddWithSheetReceipt,
  buildPivotRefreshAllReceipt,
  buildPivotRefreshReceipt,
  materializePivotForReceipt,
  runPivotMutationReceipt,
} from './receipts';
import { computePivotForReceipt, queryPivotForReceipt } from './read-receipts';

type PivotSnapshotEntry =
  | { readonly status: 'live'; readonly config: DataPivotTableConfig }
  | { readonly status: 'deleted' };
type PivotCreateOptions = Parameters<WorksheetPivots['add']>[1];
type PivotCreateWithSheetOptions = Parameters<WorksheetPivots['addWithSheet']>[2];
type PivotRangeByName = (options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}) => Promise<CellRange | null>;

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

  /** Monotonic counter to ensure unique pivot IDs within the same millisecond. */
  private static _idCounter = 0;

  async add(
    config: PivotCreateDataConfig | ApiPivotTableConfig,
    options?: PivotCreateOptions,
  ): Promise<PivotAddReceipt> {
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
    const created = this.cachePivot(await this.ctx.pivot.createPivot(configWithId));
    const pivotId = this.pivotId(created);
    const materialization = await materializePivotForReceipt(options?.lifecycle, () =>
      this.ctx.pivot.refresh(this.sheetId, pivotId),
    );
    return buildPivotAddReceipt({
      sheetId: this.sheetId,
      config: created,
      lifecycle: options?.lifecycle ?? 'defineOnly',
      result: materialization.result,
      materializationError: materialization.error,
    });
  }

  async addWithSheet(
    sheetName: string,
    config: PivotCreateDataConfig | ApiPivotTableConfig,
    options?: PivotCreateWithSheetOptions,
  ): Promise<PivotAddWithSheetReceipt> {
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
    const placementOptions =
      options?.insertBeforeSheetId !== undefined || options?.insertIndex !== undefined
        ? {
            ...(options.insertBeforeSheetId !== undefined
              ? { insertBeforeSheetId: options.insertBeforeSheetId }
              : {}),
            ...(options.insertIndex !== undefined ? { insertIndex: options.insertIndex } : {}),
          }
        : undefined;
    const result = placementOptions
      ? await this.ctx.pivot.createPivotWithSheet(sheetName, configWithId, placementOptions)
      : await this.ctx.pivot.createPivotWithSheet(sheetName, configWithId);
    // Sync cached sheet metadata so wb.sheetNames reflects the newly created sheet
    if (this.workbook) {
      await (this.workbook as WorkbookInternal).refreshSheetMetadata();
    }
    const sheetId = toSheetId(result.sheetId);
    const created = this.cachePivot(result.config);
    const pivotId = this.pivotId(created);
    const materialization = await materializePivotForReceipt(options?.lifecycle, () =>
      this.ctx.pivot.refresh(sheetId, pivotId),
    );
    return buildPivotAddWithSheetReceipt({
      sheetId,
      sheetName,
      config: created,
      lifecycle: options?.lifecycle ?? 'defineOnly',
      result: materialization.result,
      materializationError: materialization.error,
    });
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

  async rename(name: string, newName: string) {
    return applyPivotRenameReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      newName,
      cachePivot: (config) => this.cachePivot(config),
    });
  }

  async remove(name: string) {
    this._assertLive('remove');
    return applyPivotRemoveReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      markPivotDeleted: (pivotId) => this.markPivotDeleted(pivotId),
    });
  }

  async clear() {
    this._assertLive('clear');
    return applyPivotClearReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      markPivotDeleted: (pivotId) => this.markPivotDeleted(pivotId),
    });
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
  ) {
    return runPivotMutationReceipt({
      kind: 'pivot.addField',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      mutate: () =>
        addPivotField({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          fieldId,
          area,
          placementOptions: options,
        }),
      cachePivot: (config) => this.cachePivot(config),
    });
  }

  async removeField(name: string, fieldId: string, area: PivotFieldArea) {
    return runPivotMutationReceipt({
      kind: 'pivot.removeField',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) =>
        config && !config.placements.some((p) => p.fieldId === fieldId && p.area === area)
          ? 'fieldNotPlaced'
          : null,
      mutate: () =>
        removePivotField({ ctx: this.ctx, sheetId: this.sheetId, pivotName: name, fieldId, area }),
      cachePivot: (config) => this.cachePivot(config),
    });
  }

  async moveField(
    name: string,
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    toPosition: number,
  ) {
    return runPivotMutationReceipt({
      kind: 'pivot.moveField',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) => {
        const p = config?.placements.find(
          (candidate) => candidate.fieldId === fieldId && candidate.area === fromArea,
        );
        return p && p.area === toArea && p.position === toPosition ? 'alreadyAtTarget' : null;
      },
      mutate: () =>
        movePivotField({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          fieldId,
          fromArea,
          toArea,
          toPosition,
        }),
      cachePivot: (config) => this.cachePivot(config),
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

  async setFilter(name: string, fieldId: string, filter: Omit<PivotFilter, 'fieldId'>) {
    return runPivotMutationReceipt({
      kind: 'pivot.setFilter',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      mutate: () =>
        setPivotFilterByName({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          fieldId,
          filter,
        }),
      cachePivot: (config) => this.cachePivot(config),
    });
  }

  async removeFilter(name: string, fieldId: string) {
    return runPivotMutationReceipt({
      kind: 'pivot.removeFilter',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) =>
        config && !config.filters.some((filter) => filter.fieldId === fieldId)
          ? 'filterNotSet'
          : null,
      mutate: () =>
        removePivotFilterByName({ ctx: this.ctx, sheetId: this.sheetId, pivotName: name, fieldId }),
      cachePivot: (config) => this.cachePivot(config),
    });
  }

  async resetField(name: string, fieldId: string) {
    return runPivotMutationReceipt({
      kind: 'pivot.resetField',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      mutate: () =>
        resetPivotField({ ctx: this.ctx, sheetId: this.sheetId, pivotName: name, fieldId }),
      cachePivot: (config) => this.cachePivot(config),
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

  async detectFields(
    sourceSheetId: SheetId,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<any[]> {
    return await this.ctx.pivot.detectFields(sourceSheetId, range);
  }

  async compute(name: string, forceRefresh?: boolean): Promise<PivotComputeReceipt> {
    this._assertLive('compute');
    return computePivotForReceipt({ ctx: this.ctx, sheetId: this.sheetId, name, forceRefresh });
  }

  async refresh(name: string): Promise<PivotRefreshReceipt> {
    const pivotId = await this.resolveNameToId(name, 'refresh');
    return this._refreshByPivotId(pivotId);
  }

  async refreshAll(): Promise<PivotRefreshAllReceipt> {
    let pivots: DataPivotTableConfig[];
    try {
      pivots = await this.ctx.pivot.getAllPivots(this.sheetId);
    } catch (error) {
      return buildPivotRefreshAllReceipt({
        sheetId: this.sheetId,
        receipts: [],
        listError: error,
      });
    }
    const receipts = await Promise.all(pivots.map((p) => this._refreshByPivotId(p.id ?? p.name)));
    return buildPivotRefreshAllReceipt({
      sheetId: this.sheetId,
      receipts,
    });
  }

  private async _refreshByPivotId(pivotId: string): Promise<PivotRefreshReceipt> {
    let result: PivotTableResult | null = null;
    let config: DataPivotTableConfig | null = null;
    let error: unknown;
    try {
      result = await this.ctx.pivot.refresh(this.sheetId, pivotId);
    } catch (caught) {
      error = caught;
    }
    try {
      config = await this.ctx.pivot.getPivot(this.sheetId, pivotId);
    } catch (caught) {
      error ??= caught;
    }
    if (config) {
      this.cachePivot(config);
    }
    return buildPivotRefreshReceipt({
      sheetId: this.sheetId,
      pivotId,
      config,
      result,
      materializationError: error,
    });
  }

  async getDrillDownData(name: string, rowKey: string, columnKey: string): Promise<CellValue[][]> {
    const pivotId = await this.resolveNameToId(name, 'getDrillDownData');
    return await this.ctx.pivot.getDrillDownData(this.sheetId, pivotId, rowKey, columnKey);
  }

  async queryPivot(
    pivotName: string,
    filters?: Record<string, CellValue | CellValue[]>,
  ): Promise<PivotQueryReceipt> {
    this._assertLive('queryPivot');
    return queryPivotForReceipt({ ctx: this.ctx, sheetId: this.sheetId, pivotName, filters });
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
  ) {
    return runPivotMutationReceipt({
      kind: 'pivot.setPivotItemVisibility',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) =>
        config &&
        Object.keys(visibleItems).length === 0 &&
        !config.filters.some((f) => f.fieldId === fieldId)
          ? 'emptyVisibilityUnchanged'
          : null,
      mutate: () =>
        setPivotItemVisibilityByName({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          fieldId,
          visibleItems,
        }),
      cachePivot: (config) => this.cachePivot(config),
    });
  }

  async setItemVisibility(name: string, fieldId: string, visibleItems: Record<string, boolean>) {
    return runPivotMutationReceipt({
      kind: 'pivot.setItemVisibility',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      mutate: () =>
        setPivotItemVisibilityByName({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          fieldId,
          visibleItems,
        }),
      cachePivot: (config) => this.cachePivot(config),
    });
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

  async setAllExpanded(name: string, expanded: boolean) {
    return runPivotMutationReceipt({
      kind: 'pivot.setAllExpanded',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) => (config && !this.ctx.pivotExpansionProvider ? 'noExpansionProvider' : null),
      mutate: async (config) => {
        if (!config)
          throw new KernelError('COMPUTE_ERROR', `setAllExpanded: Pivot table "${name}" not found`);
        this.ctx.pivotExpansionProvider?.setAllExpanded(this.pivotId(config), expanded);
      },
      extra: { expanded },
    });
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

  async setDataSource(name: string, dataSource: string) {
    return runPivotMutationReceipt({
      kind: 'pivot.setDataSource',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      mutate: async (config) => {
        if (!config)
          throw new KernelError('COMPUTE_ERROR', `setDataSource: Pivot table "${name}" not found`);
        await this._setDataSourceByPivotId(this.pivotId(config), config, dataSource, name);
      },
      cachePivot: (config) => this.cachePivot(config),
      extra: { dataSource },
    });
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

  async setAllowMultipleFiltersPerField(name: string, allow: boolean) {
    return runPivotMutationReceipt({
      kind: 'pivot.setAllowMultipleFiltersPerField',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) =>
        config && (config.allowMultipleFiltersPerField ?? false) === allow
          ? 'unchangedOption'
          : null,
      mutate: () =>
        setPivotAllowMultipleFiltersPerField({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          allow,
        }),
      cachePivot: (config) => this.cachePivot(config),
      extra: { allowMultipleFiltersPerField: allow },
    });
  }

  async getAutoFormat(name: string): Promise<boolean> {
    return getPivotAutoFormat({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async setAutoFormat(name: string, autoFormat: boolean) {
    return runPivotMutationReceipt({
      kind: 'pivot.setAutoFormat',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) =>
        config && (config.autoFormat ?? true) === autoFormat ? 'unchangedOption' : null,
      mutate: () =>
        setPivotAutoFormat({ ctx: this.ctx, sheetId: this.sheetId, pivotName: name, autoFormat }),
      cachePivot: (config) => this.cachePivot(config),
      extra: { autoFormat },
    });
  }

  async getPreserveFormatting(name: string): Promise<boolean> {
    return getPivotPreserveFormatting({
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
    });
  }

  async setPreserveFormatting(name: string, preserve: boolean) {
    return runPivotMutationReceipt({
      kind: 'pivot.setPreserveFormatting',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) =>
        config && (config.preserveFormatting ?? true) === preserve ? 'unchangedOption' : null,
      mutate: () =>
        setPivotPreserveFormatting({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          preserve,
        }),
      cachePivot: (config) => this.cachePivot(config),
      extra: { preserveFormatting: preserve },
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

  async setEnableMultipleFilterItems(name: string, _fieldId: string, enabled: boolean) {
    return runPivotMutationReceipt({
      kind: 'pivot.setEnableMultipleFilterItems',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) =>
        config && (config.allowMultipleFiltersPerField ?? false) === enabled
          ? 'unchangedOption'
          : null,
      mutate: () =>
        setPivotEnableMultipleFilterItems({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          enabled,
        }),
      cachePivot: (config) => this.cachePivot(config),
      extra: { fieldId: _fieldId, enableMultipleFilterItems: enabled },
    });
  }

  // ===========================================================================
  // Calculated Fields
  // ===========================================================================

  async addCalculatedField(name: string, field: CalculatedField) {
    return runPivotMutationReceipt({
      kind: 'pivot.addCalculatedField',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      mutate: () =>
        addPivotCalculatedFieldByName({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          field,
        }),
      cachePivot: (config) => this.cachePivot(config),
      extra: { calculatedFieldId: field.calculatedFieldId },
    });
  }

  async removeCalculatedField(name: string, fieldId: string) {
    return runPivotMutationReceipt({
      kind: 'pivot.removeCalculatedField',
      ctx: this.ctx,
      sheetId: this.sheetId,
      pivotName: name,
      noOp: (config) =>
        config &&
        !(config.calculatedFields ?? []).some((field) => field.fieldId === fieldId) &&
        !config.placements.some((p) => p.fieldId === fieldId || p.calculatedFieldId === fieldId)
          ? 'calculatedFieldNotPresent'
          : null,
      mutate: () =>
        removePivotCalculatedFieldByName({
          ctx: this.ctx,
          sheetId: this.sheetId,
          pivotName: name,
          fieldId,
        }),
      cachePivot: (config) => this.cachePivot(config),
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

  async getRange(name: string): Promise<WorksheetRange | null> {
    return this.publicRangeForPivot(name, getPivotRangeByName);
  }

  async getDataBodyRange(name: string): Promise<WorksheetRange | null> {
    return this.publicRangeForPivot(name, getPivotDataBodyRangeByName);
  }

  async getColumnLabelRange(name: string): Promise<WorksheetRange | null> {
    return this.publicRangeForPivot(name, getPivotColumnLabelRangeByName);
  }

  async getRowLabelRange(name: string): Promise<WorksheetRange | null> {
    return this.publicRangeForPivot(name, getPivotRowLabelRangeByName);
  }

  async getFilterAxisRange(name: string): Promise<WorksheetRange | null> {
    return this.publicRangeForPivot(name, getPivotFilterAxisRangeByName);
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
      getRange: async (pivotId) =>
        toWorksheetRangeOrNull(
          await getPivotRangeForId({ ctx: this.ctx, sheetId: this.sheetId, pivotId }),
        ),
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
      ...(p.layout ? { layout: p.layout } : {}),
    };
  }

  private async getContentAreaForPivot(pivotId: string): Promise<string> {
    const range = await getPivotRangeForId({ ctx: this.ctx, sheetId: this.sheetId, pivotId });
    return range ? rangeToA1(range) : '';
  }

  private async publicRangeForPivot(
    pivotName: string,
    getRange: PivotRangeByName,
  ): Promise<WorksheetRange | null> {
    return toWorksheetRangeOrNull(
      await getRange({
        ctx: this.ctx,
        sheetId: this.sheetId,
        pivotName,
      }),
    );
  }
}
