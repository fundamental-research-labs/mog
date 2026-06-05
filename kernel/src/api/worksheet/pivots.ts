/**
 * WorksheetPivotsImpl — Implementation of the WorksheetPivots sub-API.
 *
 * Calls ctx.pivot bridge methods directly, throwing KernelError on failure.
 * No intermediate OperationResult / unwrap layer.
 *
 * The worksheet instance knows its sheetId, so operations don't need
 * sheetId as a parameter — it comes from the worksheet context.
 */
import type {
  PivotTableConfig as ApiPivotTableConfig,
  PivotRefreshReceipt,
  PivotTableHandle,
  PivotTableInfo,
  PivotQueryRecord,
  PivotQueryResult,
  PivotCalculatedFieldSpec,
  PivotPlacementPatch,
  PivotPlacementSpec,
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
  CalculatedFieldId,
  DataSourceType,
  PivotDataHierarchyInfo,
  PivotExpansionState,
  PivotFieldArea,
  PivotFieldItems,
  PivotFieldPlacementFlat,
  PivotFilter,
  PivotItemLocation,
  PivotKernelMutationReceipt,
  PivotMemberKey,
  PivotPlacementMutationReceipt,
  SortOrder,
  PivotTableConfig as DataPivotTableConfig,
  ShowValuesAsConfig,
  PlacementId,
  PivotTableResult,
  PivotTableLayout,
  PivotTableStyle,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import {
  KernelError,
  createPivotAmbiguousPlacementError,
} from '../../errors';
import { toA1 } from '../internal/utils';
import { pivotStyleIdForCompute } from '../../domain/pivots/style-normalization';
import { buildPivotTableHandle } from './pivot-handle';
import {
  convertSimpleToDataConfig,
  isSimplePivotConfig,
  updatePivotDataSource,
  type PivotCreateDataConfig,
} from './pivot-data-source';

type PivotFieldPlacement = PivotFieldPlacementFlat;
type PivotSortDirection = Exclude<SortOrder, 'none'>;

const PIVOT_CONFIG_SCHEMA_VERSION = 2;

function pivotPlacementId(id: string): PlacementId {
  return id as PlacementId;
}

function pivotCalculatedFieldId(id: string): CalculatedFieldId {
  return id as CalculatedFieldId;
}

function pivotMemberKey(key: string): PivotMemberKey {
  return key as PivotMemberKey;
}

function makePlacementId(area: PivotFieldArea, fieldId: string, position: number): PlacementId {
  return pivotPlacementId(`${area}:${fieldId}:${position}`);
}

function cleanPivotFormula(formula: string): string {
  return formula.startsWith('=') ? formula.slice(1) : formula;
}

function configWithRequiredMetadata(
  config: PivotCreateDataConfig,
  id: string,
): DataPivotTableConfig {
  return {
    schemaVersion: PIVOT_CONFIG_SCHEMA_VERSION,
    ...config,
    id,
  };
}

/**
 * Format a source range + sheet name into a proper data source string like "Sheet1!A1:D100".
 */
function formatDataSource(
  sourceSheetName: string | null,
  sourceRange: DataPivotTableConfig['sourceRange'],
): string {
  if (!sourceRange) return '';
  const start = toA1(sourceRange.startRow, sourceRange.startCol);
  const end = toA1(sourceRange.endRow, sourceRange.endCol);
  const sheetRef = sourceSheetName ?? 'Unknown';
  const needsQuotes = /[^A-Za-z0-9_]/.test(sheetRef);
  const quotedSheet = needsQuotes ? `'${sheetRef}'` : sheetRef;
  return `${quotedSheet}!${start}:${end}`;
}

/**
 * Convert a data-contract PivotTableConfig to an API-level PivotTableConfig.
 * Extracts row/column/value/filter fields from the unified placements array.
 *
 * @param sourceSheetName - Resolved sheet name for formatting the dataSource string.
 */
function dataConfigToApiConfig(
  dataConfig: DataPivotTableConfig,
  sourceSheetName: string | null,
): ApiPivotTableConfig {
  const rowFields: string[] = [];
  const columnFields: string[] = [];
  const valueFields: {
    placementId?: PlacementId;
    field: string;
    aggregation: 'sum' | 'count' | 'average' | 'max' | 'min';
    label?: string;
  }[] = [];
  const filterFields: string[] = [];

  for (const p of dataConfig.placements) {
    switch (p.area) {
      case 'row':
        rowFields.push(p.fieldId);
        break;
      case 'column':
        columnFields.push(p.fieldId);
        break;
      case 'value':
        valueFields.push({
          placementId: p.placementId ?? makePlacementId('value', p.fieldId, p.position),
          field: p.fieldId,
          aggregation: (p.aggregateFunction ?? 'sum') as
            | 'sum'
            | 'count'
            | 'average'
            | 'max'
            | 'min',
          label: p.displayName ?? undefined,
        });
        break;
      case 'filter':
        filterFields.push(p.fieldId);
        break;
    }
  }

  return {
    name: dataConfig.name,
    dataSource: formatDataSource(sourceSheetName, dataConfig.sourceRange),
    rowFields,
    columnFields,
    valueFields,
    filterFields,
    allowMultipleFiltersPerField: dataConfig.allowMultipleFiltersPerField ?? undefined,
    autoFormat: dataConfig.autoFormat ?? undefined,
    preserveFormatting: dataConfig.preserveFormatting ?? undefined,
  };
}

/**
 * Helper: get a pivot by ID, throwing if not found.
 */
async function requirePivot(
  ctx: DocumentContext,
  sheetId: SheetId,
  pivotId: string,
  operation: string,
): Promise<DataPivotTableConfig> {
  const config = await ctx.pivot.getPivot(sheetId, pivotId);
  if (!config) {
    throw new KernelError('COMPUTE_ERROR', `${operation}: Pivot table not found`);
  }
  return config;
}

export class WorksheetPivotsImpl implements WorksheetPivots {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
    private readonly workbook?: Workbook | null,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  // ---------------------------------------------------------------------------
  // Name → ID resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve a pivot table name to its ID.
   * Throws KernelError if not found.
   */
  private async resolveNameToId(name: string, operation: string): Promise<string> {
    const pivot = await this.findPivotByName(name);
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
    return await this.ctx.pivot.createPivot(configWithId);
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
    return { sheetId: toSheetId(result.sheetId), config: result.config };
  }

  async getAll(): Promise<DataPivotTableConfig[]> {
    try {
      return await this.ctx.pivot.getAllPivots(this.sheetId);
    } catch {
      return [];
    }
  }

  async getImportedViewRecords(): Promise<ImportedPivotViewRecord[]> {
    try {
      return await this.ctx.pivot.getImportedPivotViewRecords(this.sheetId);
    } catch {
      return [];
    }
  }

  async rename(name: string, newName: string): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'rename');
    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { name: newName },
      { reason: 'renamed', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async remove(name: string): Promise<void> {
    const pivot = await this.findPivotByName(name);
    if (!pivot) {
      throw new KernelError('COMPUTE_ERROR', `Pivot table "${name}" not found`);
    }
    if (!pivot.id) {
      throw new KernelError('COMPUTE_ERROR', 'Pivot ID is required');
    }
    await this.ctx.pivot.deletePivot(this.sheetId, pivot.id);
  }

  async clear(): Promise<void> {
    const pivots = await this.list();
    for (const pivot of pivots) {
      await this.remove(pivot.name);
    }
  }

  async list(): Promise<PivotTableInfo[]> {
    let pivots: DataPivotTableConfig[];
    try {
      pivots = await this.ctx.pivot.getAllPivots(this.sheetId);
    } catch {
      return [];
    }
    return pivots.map((p) => {
      const apiConfig = dataConfigToApiConfig(p, p.sourceSheetName);
      const location = p.outputLocation
        ? toA1(p.outputLocation.row, p.outputLocation.col)
        : undefined;
      return {
        name: p.name ?? p.id,
        dataSource: apiConfig.dataSource,
        contentArea: '',
        filterArea: undefined,
        location,
        rowFields: apiConfig.rowFields,
        columnFields: apiConfig.columnFields,
        valueFields: apiConfig.valueFields,
        filterFields: apiConfig.filterFields,
      };
    });
  }

  async get(pivotRef: string | DataPivotTableConfig): Promise<PivotTableHandle | null> {
    const pivot =
      typeof pivotRef === 'string'
        ? await this.findPivotByName(pivotRef)
        : await this.ctx.pivot.getPivot(this.sheetId, pivotRef.id);
    if (!pivot) {
      return null;
    }
    return this.buildHandle(pivot, pivot.sourceSheetName);
  }

  async getInfo(name: string): Promise<PivotTableInfo | null> {
    const pivot = await this.findPivotByName(name);
    if (!pivot) {
      return null;
    }
    const apiConfig = dataConfigToApiConfig(pivot, pivot.sourceSheetName);
    const location = pivot.outputLocation
      ? toA1(pivot.outputLocation.row, pivot.outputLocation.col)
      : undefined;
    return {
      name: pivot.name ?? pivot.id,
      dataSource: apiConfig.dataSource,
      contentArea: '',
      filterArea: undefined,
      location,
      rowFields: apiConfig.rowFields,
      columnFields: apiConfig.columnFields,
      valueFields: apiConfig.valueFields,
      filterFields: apiConfig.filterFields,
    };
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
    return config.placements.map((placement) => this.placementReadout(config, placement));
  }

  async findPlacementsByField(name: string, fieldIdOrName: string): Promise<any[]> {
    const pivotId = await this.resolveNameToId(name, 'findPlacementsByField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'findPlacementsByField');
    return config.placements
      .filter((placement) => {
        const fieldName = this.placementFieldName(config, placement);
        return placement.fieldId === fieldIdOrName || fieldName === fieldIdOrName;
      })
      .map((placement) => this.placementReadout(config, placement));
  }

  // ===========================================================================
  // Field Placement
  // ===========================================================================

  async addPlacement(
    pivotId: string,
    spec: PivotPlacementSpec,
  ): Promise<PivotPlacementMutationReceipt> {
    return this.ctx.pivot.addPlacement(pivotId, spec);
  }

  async updatePlacement(
    pivotId: string,
    placementId: PlacementId,
    patch: PivotPlacementPatch,
  ): Promise<PivotKernelMutationReceipt> {
    return this.ctx.pivot.updatePlacement(pivotId, placementId, patch);
  }

  async removePlacement(
    pivotId: string,
    placementId: PlacementId,
  ): Promise<PivotKernelMutationReceipt> {
    return this.ctx.pivot.removePlacement(pivotId, placementId);
  }

  async movePlacement(
    pivotId: string,
    placementId: PlacementId,
    toArea: PivotFieldArea,
    toPosition: number,
  ): Promise<PivotKernelMutationReceipt> {
    return this.ctx.pivot.movePlacement(pivotId, placementId, toArea, toPosition);
  }

  async renameValuePlacement(
    pivotId: string,
    placementId: PlacementId,
    displayName: string | null,
  ): Promise<PivotKernelMutationReceipt> {
    return this.ctx.pivot.renameValuePlacement(pivotId, placementId, displayName);
  }

  async setSortByValue(
    pivotId: string,
    axisPlacementId: PlacementId,
    valuePlacementId: PlacementId,
    config: { order: SortOrder; columnKey?: string } | null,
  ): Promise<PivotKernelMutationReceipt> {
    return this.ctx.pivot.setSortByValue(pivotId, axisPlacementId, valuePlacementId, config);
  }

  async resetPlacement(
    pivotId: string,
    placementId: PlacementId,
  ): Promise<PivotKernelMutationReceipt> {
    return this.ctx.pivot.resetPlacement(pivotId, placementId);
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
    const pivotId = await this.resolveNameToId(name, 'addField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'addFieldPlacement');

    const placements = [...config.placements];

    // Determine position: use provided or append at end of area
    const areaItems = placements.filter((p) => p.area === area);
    const position = options?.position ?? areaItems.length;

    // Default aggregateFunction to 'sum' for value area placements since the
    // Rust bridge requires this field to be present for serialization.
    const aggregateFunction = options?.aggregateFunction ?? (area === 'value' ? 'sum' : undefined);

    placements.push({
      placementId: makePlacementId(area, fieldId, position),
      fieldId,
      area,
      position,
      aggregateFunction: aggregateFunction as AggregateFunction | undefined,
      sortOrder: options?.sortOrder === 'none' ? undefined : options?.sortOrder,
      displayName: options?.displayName,
      showValuesAs: options?.showValuesAs,
    });

    // Renumber positions within the target area
    let pos = 0;
    for (const p of placements) {
      if (p.area === area) {
        p.position = pos++;
      }
    }

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async removeField(name: string, fieldId: string, area: PivotFieldArea): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'removeField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'removeFieldPlacement');

    const placements = config.placements.filter((p) => !(p.fieldId === fieldId && p.area === area));

    // Renumber positions within the affected area
    let pos = 0;
    for (const p of placements) {
      if (p.area === area) {
        p.position = pos++;
      }
    }

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async moveField(
    name: string,
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    toPosition: number,
  ): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'moveField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'moveFieldPlacement');

    // Find the placement to move
    const sourceIndex = config.placements.findIndex(
      (p) => p.fieldId === fieldId && p.area === fromArea,
    );
    if (sourceIndex === -1) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'moveFieldPlacement: Field placement not found in source area',
      );
    }

    // Remove from source
    const placements = [...config.placements];
    const [moved] = placements.splice(sourceIndex, 1);

    // Update the area
    moved.area = toArea;
    moved.position = toPosition;

    // Insert into target area at the correct position
    const targetAreaItems = placements.filter((p) => p.area === toArea);
    if (toPosition >= targetAreaItems.length) {
      // Append at end
      placements.push(moved);
    } else {
      // Find the index of the item currently at toPosition in the target area
      let count = 0;
      let insertAt = placements.length;
      for (let i = 0; i < placements.length; i++) {
        if (placements[i].area === toArea) {
          if (count === toPosition) {
            insertAt = i;
            break;
          }
          count++;
        }
      }
      placements.splice(insertAt, 0, moved);
    }

    // Renumber positions within the source area
    let pos = 0;
    for (const p of placements) {
      if (p.area === fromArea) {
        p.position = pos++;
      }
    }

    // Renumber positions within the target area (if different from source)
    if (fromArea !== toArea) {
      pos = 0;
      for (const p of placements) {
        if (p.area === toArea) {
          p.position = pos++;
        }
      }
    }

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
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
    const { pivotId, config } = await this.resolvePivotName(
      pivotOrName,
      'setAggregateFunction',
    );
    const target = this.resolvePlacement(
      config,
      placementOrFieldId,
      'value',
      'setAggregateFunction',
    );
    if (this.placementId(target) === placementOrFieldId) {
      return this.ctx.pivot.setAggregateFunction(
        pivotId,
        pivotPlacementId(placementOrFieldId),
        aggregateFunction,
      );
    }

    const placements = config.placements.map((p) =>
      p === target ? { ...p, aggregateFunction } : p,
    );

    const result = await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { placements },
      { reason: 'aggregateFunctionChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return this.createPlacementReceipt(
      pivotId,
      this.placementId(target),
      'aggregateFunctionChanged',
      'refreshAndMaterialize',
      result,
    );
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
    const { pivotId, config } = await this.resolvePivotName(pivotOrName, 'setShowValuesAs');
    const target = this.resolvePlacement(config, placementOrFieldId, 'value', 'setShowValuesAs');
    if (this.placementId(target) === placementOrFieldId) {
      return this.ctx.pivot.setShowValuesAs(
        pivotId,
        pivotPlacementId(placementOrFieldId),
        showValuesAs,
      );
    }

    const placements = config.placements.map((p) =>
      p === target ? { ...p, showValuesAs: showValuesAs ?? undefined } : p,
    );

    const result = await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { placements },
      { reason: 'showValuesAsChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return this.createPlacementReceipt(
      pivotId,
      this.placementId(target),
      'showValuesAsChanged',
      'refreshAndMaterialize',
      result,
    );
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
    const { pivotId, config } = await this.resolvePivotName(pivotOrName, 'setSortOrder');
    const target = this.resolvePlacement(config, placementOrFieldId, null, 'setSortOrder');
    if (target.area !== 'row' && target.area !== 'column') {
      throw new KernelError(
        'COMPUTE_ERROR',
        'setSortOrder: Pivot placement must be in the row or column area',
      );
    }
    if (this.placementId(target) === placementOrFieldId) {
      return this.ctx.pivot.setSortOrder(pivotId, pivotPlacementId(placementOrFieldId), sortOrder);
    }

    const sortDirection: PivotSortDirection | undefined =
      !sortOrder || sortOrder === 'none' ? undefined : sortOrder;
    const placements = config.placements.map((p) =>
      p === target ? { ...p, sortOrder: sortDirection } : p,
    );

    const result = await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { placements },
      { reason: 'sortOrderChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return this.createPlacementReceipt(
      pivotId,
      this.placementId(target),
      'sortOrderChanged',
      'refreshAndMaterialize',
      result,
    );
  }

  async setFilter(
    name: string,
    fieldId: string,
    filter: Omit<PivotFilter, 'fieldId'>,
  ): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setFilter');
    await this.setFilterForPivotId(pivotId, fieldId, filter);
  }

  private async setFilterForPivotId(
    pivotId: string,
    fieldId: string,
    filter: Omit<PivotFilter, 'fieldId'>,
  ): Promise<void> {
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'setFilter');

    // Replace existing filter for this field, or add new one
    const filters = config.filters.filter((f) => f.fieldId !== fieldId);
    filters.push({ ...filter, fieldId });

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { filters },
      { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async removeFilter(name: string, fieldId: string): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'removeFilter');
    await this._removeFilterByPivotId(pivotId, fieldId);
  }

  private async _removeFilterByPivotId(pivotId: string, fieldId: string): Promise<void> {
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'removeFilter');

    const filters = config.filters.filter((f) => f.fieldId !== fieldId);

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { filters },
      { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async resetField(name: string, fieldId: string): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'resetField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'resetField');

    const placements = config.placements.map((p) =>
      p.fieldId === fieldId
        ? {
            placementId: p.placementId,
            fieldId: p.fieldId,
            calculatedFieldId: p.calculatedFieldId,
            area: p.area,
            position: p.position,
          }
        : p,
    );

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { placements },
      { reason: 'fieldReset', refreshPolicy: 'refreshAndMaterialize' },
    );
    await this._removeFilterByPivotId(pivotId, fieldId);
  }

  // ===========================================================================
  // Layout and Style
  // ===========================================================================

  async setLayout(name: string, layout: Partial<PivotTableLayout>): Promise<any> {
    const pivotId = await this.resolveNameToId(name, 'setLayout');
    return this._setLayoutByPivotId(pivotId, name, layout);
  }

  private async _setLayoutByPivotId(
    pivotId: string,
    pivotName: string,
    layout: Partial<PivotTableLayout>,
  ): Promise<PivotKernelMutationReceipt> {
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'setLayout');

    const mergedLayout = { ...config.layout, ...layout };

    const result = await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { layout: mergedLayout },
      { reason: 'layoutChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return {
      kernelReceiptId: `${pivotId}:layoutChanged:${Date.now()}`,
      pivotId,
      effects: [],
      mutationResult: { action: 'setLayout', pivotName, layout },
      updateReason: 'layoutChanged',
      refreshPolicy: 'refreshAndMaterialize',
      materialized: true,
      configRevision: 0,
      status: result ? 'applied' : 'noOp',
    };
  }

  async setStyle(name: string, style: Partial<PivotTableStyle>): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setStyle');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'setStyle');

    const mergedStyle = {
      ...config.style,
      ...style,
      ...(style.styleName !== undefined
        ? { styleName: pivotStyleIdForCompute(style.styleName) ?? style.styleName }
        : {}),
    };

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { style: mergedStyle },
      { reason: 'styleChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
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
    const pivot = await this.findPivotByName(pivotName);
    if (!pivot) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `queryPivot: Pivot table "${pivotName}" not found on this sheet`,
      );
    }

    const pivotId = pivot.id ?? pivot.name;

    // Compute the pivot table result
    const result: PivotTableResult | null = await this.ctx.pivot.compute(this.sheetId, pivotId);
    if (!result) return null;

    // Build field name lookup from config.fields[]
    const fieldNameById = new Map<string, string>();
    for (const f of pivot.fields) {
      fieldNameById.set(f.id, f.name);
    }

    // Extract placements by area, sorted by position
    const rowPlacements = pivot.placements
      .filter((p) => p.area === 'row')
      .sort((a, b) => a.position - b.position);
    const colPlacements = pivot.placements
      .filter((p) => p.area === 'column')
      .sort((a, b) => a.position - b.position);
    const valuePlacements = pivot.placements
      .filter((p) => p.area === 'value')
      .sort((a, b) => a.position - b.position);

    const rowFieldNames = rowPlacements.map((p) => fieldNameById.get(p.fieldId) ?? p.fieldId);
    const colFieldNames = colPlacements.map((p) => fieldNameById.get(p.fieldId) ?? p.fieldId);
    const valueFieldLabels = valuePlacements.map((p) => {
      if (p.displayName) return p.displayName;
      const name = fieldNameById.get(p.fieldId) ?? p.fieldId;
      const agg = p.aggregateFunction ?? 'sum';
      return `${agg.charAt(0).toUpperCase() + agg.slice(1)} of ${name}`;
    });

    // Reconstruct column dimension tuples from columnHeaders.
    // Each PivotColumnHeader has { fieldId, headers: PivotHeader[] } where
    // headers have span values indicating how many data columns they cover.
    const numDataCols = result.renderedBounds.numDataCols;
    const colDimensionTuples: Record<string, CellValue>[] = [];

    if (colPlacements.length > 0 && result.columnHeaders.length > 0) {
      for (let i = 0; i < numDataCols; i++) {
        colDimensionTuples.push({});
      }
      for (const level of result.columnHeaders) {
        const fieldName = fieldNameById.get(level.fieldId) ?? level.fieldId;
        let colIndex = 0;
        for (const header of level.headers) {
          if (!header.isSubtotal && !header.isGrandTotal) {
            for (let s = 0; s < header.span; s++) {
              if (colIndex + s < numDataCols) {
                colDimensionTuples[colIndex + s][fieldName] = header.value;
              }
            }
          }
          colIndex += header.span;
        }
      }
    }

    // Flatten rows into records
    const records: PivotQueryRecord[] = [];

    for (const row of result.rows) {
      if (row.isSubtotal || row.isGrandTotal) continue;

      // Build row dimensions from headers
      const rowDimensions: Record<string, CellValue> = {};
      for (const header of row.headers) {
        if (header.isSubtotal || header.isGrandTotal) continue;
        const fieldName = fieldNameById.get(header.fieldId) ?? header.fieldId;
        rowDimensions[fieldName] = header.value;
      }

      if (colDimensionTuples.length > 0) {
        // One record per column dimension combination
        for (let colIdx = 0; colIdx < colDimensionTuples.length; colIdx++) {
          const colDims = colDimensionTuples[colIdx];
          if (!colDims || Object.keys(colDims).length === 0) continue;

          const dimensions = { ...rowDimensions, ...colDims };
          const values: Record<string, CellValue> = {};

          if (valuePlacements.length <= 1) {
            values[valueFieldLabels[0] ?? 'Value'] = row.values[colIdx] ?? null;
          } else {
            const valueIndex = colIdx % valuePlacements.length;
            values[valueFieldLabels[valueIndex] ?? 'Value'] = row.values[colIdx] ?? null;
          }

          records.push({ dimensions, values });
        }
      } else {
        // No column dimensions — one record per row with all values
        const values: Record<string, CellValue> = {};
        for (let i = 0; i < valuePlacements.length; i++) {
          values[valueFieldLabels[i] ?? `Value${i}`] = row.values[i] ?? null;
        }
        records.push({ dimensions: rowDimensions, values });
      }
    }

    // Apply dimension filters
    const filteredRecords = filters
      ? records.filter((record) => {
          for (const [field, filterValue] of Object.entries(filters)) {
            const dimValue = record.dimensions[field];
            if (Array.isArray(filterValue)) {
              if (!filterValue.some((fv) => String(fv) === String(dimValue))) return false;
            } else {
              if (String(filterValue) !== String(dimValue)) return false;
            }
          }
          return true;
        })
      : records;

    return {
      pivotName,
      rowFields: rowFieldNames,
      columnFields: colFieldNames,
      valueFields: valueFieldLabels,
      records: filteredRecords,
      sourceRowCount: result.sourceRowCount,
    };
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
    const pivotId = await this.resolveNameToId(name, 'setPivotItemVisibility');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'setPivotItemVisibility');

    // Determine include vs exclude list based on which is smaller
    const visibleKeys = Object.entries(visibleItems)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const hiddenKeys = Object.entries(visibleItems)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    // Replace the existing filter for this field
    const filters = config.filters.filter((f) => f.fieldId !== fieldId);

    if (hiddenKeys.length === 0) {
      // All items visible — remove filter entirely (already done above)
    } else if (hiddenKeys.length <= visibleKeys.length) {
      // Fewer hidden items — use excludeValues
      filters.push({
        fieldId,
        excludeValues: hiddenKeys,
      } as PivotFilter);
    } else {
      // Fewer visible items — use includeValues
      filters.push({
        fieldId,
        includeValues: visibleKeys,
      } as PivotFilter);
    }

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { filters },
      { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
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
      (await this.findPivotByName(name)) ??
      (await requirePivot(this.ctx, this.sheetId, pivotId, 'setDataSource'));
    await this._setDataSourceByPivotId(pivotId, config, dataSource, name);
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
    const pivotId = await this.resolveNameToId(name, 'getAllowMultipleFiltersPerField');
    const config = await requirePivot(
      this.ctx,
      this.sheetId,
      pivotId,
      'getAllowMultipleFiltersPerField',
    );
    return config.allowMultipleFiltersPerField ?? false;
  }

  async setAllowMultipleFiltersPerField(name: string, allow: boolean): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setAllowMultipleFiltersPerField');
    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { allowMultipleFiltersPerField: allow },
      { reason: 'formattingOptionChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async getAutoFormat(name: string): Promise<boolean> {
    const pivotId = await this.resolveNameToId(name, 'getAutoFormat');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'getAutoFormat');
    return config.autoFormat ?? true;
  }

  async setAutoFormat(name: string, autoFormat: boolean): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setAutoFormat');
    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { autoFormat },
      { reason: 'formattingOptionChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async getPreserveFormatting(name: string): Promise<boolean> {
    const pivotId = await this.resolveNameToId(name, 'getPreserveFormatting');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'getPreserveFormatting');
    return config.preserveFormatting ?? true;
  }

  async setPreserveFormatting(name: string, preserve: boolean): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setPreserveFormatting');
    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { preserveFormatting: preserve },
      { reason: 'formattingOptionChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  // ===========================================================================
  // Cell Provenance (B2)
  // ===========================================================================

  async getDataHierarchy(
    name: string,
    row: number,
    col: number,
  ): Promise<PivotDataHierarchyInfo | null> {
    const pivotId = await this.resolveNameToId(name, 'getDataHierarchy');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'getDataHierarchy');
    const result: PivotTableResult | null = await this.ctx.pivot.compute(this.sheetId, pivotId);
    if (!result) return null;

    const bounds = result.renderedBounds;
    // Cell must be in the data area
    if (row < bounds.firstDataRow || col < bounds.firstDataCol) return null;
    if (row >= bounds.totalRows || col >= bounds.totalCols) return null;

    const valuePlacements = config.placements.filter(
      (p: PivotFieldPlacement) => p.area === 'value',
    );
    if (valuePlacements.length === 0) return null;

    // Data column index (0-based within the data area)
    const dataCol = col - bounds.firstDataCol;
    // Value field index cycles within each column leaf group
    const valueIndex = dataCol % valuePlacements.length;
    const vp = valuePlacements[valueIndex];
    if (!vp) return null;

    const field = config.fields.find((f: { id: string; name: string }) => f.id === vp.fieldId);
    const fieldName = field?.name ?? vp.fieldId;
    const agg = vp.aggregateFunction ?? 'sum';
    const aggLabel = agg.charAt(0).toUpperCase() + agg.slice(1);
    const displayName = vp.displayName ?? `${aggLabel} of ${fieldName}`;

    return {
      fieldId: vp.fieldId,
      displayName,
      aggregateFunction: agg as import('@mog-sdk/contracts/pivot').AggregateFunction,
      index: valueIndex,
    };
  }

  async getPivotItems(
    name: string,
    axis: 'row' | 'column',
    row: number,
    col: number,
  ): Promise<PivotItemLocation[] | null> {
    const pivotId = await this.resolveNameToId(name, 'getPivotItems');
    const result: PivotTableResult | null = await this.ctx.pivot.compute(this.sheetId, pivotId);
    if (!result) return null;

    const bounds = result.renderedBounds;
    // Cell must be in the data area
    if (row < bounds.firstDataRow || col < bounds.firstDataCol) return null;
    if (row >= bounds.totalRows || col >= bounds.totalCols) return null;

    if (axis === 'row') {
      // Row items come from the PivotRow's headers
      const dataRowIndex = row - bounds.firstDataRow;
      if (dataRowIndex < 0 || dataRowIndex >= result.rows.length) return null;
      const pivotRow = result.rows[dataRowIndex];
      return pivotRow.headers.map((h) => ({
        fieldId: h.fieldId,
        value: h.value,
        key: pivotMemberKey(h.key),
      }));
    } else {
      // Column items come from column headers at the cell's column position
      const dataCol = col - bounds.firstDataCol;
      const items: PivotItemLocation[] = [];
      for (const level of result.columnHeaders) {
        // Find the header that spans over this column
        let colOffset = 0;
        for (const h of level.headers) {
          if (dataCol >= colOffset && dataCol < colOffset + h.span) {
            items.push({
              fieldId: h.fieldId,
              value: h.value,
              key: pivotMemberKey(h.key),
            });
            break;
          }
          colOffset += h.span;
        }
      }
      return items;
    }
  }

  // ===========================================================================
  // Multiple Filter Items (B7)
  // ===========================================================================

  async getEnableMultipleFilterItems(name: string, _fieldId: string): Promise<boolean> {
    const pivotId = await this.resolveNameToId(name, 'getEnableMultipleFilterItems');
    const config = await requirePivot(
      this.ctx,
      this.sheetId,
      pivotId,
      'getEnableMultipleFilterItems',
    );
    return config.allowMultipleFiltersPerField ?? false;
  }

  async setEnableMultipleFilterItems(
    name: string,
    _fieldId: string,
    enabled: boolean,
  ): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setEnableMultipleFilterItems');
    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      {
        allowMultipleFiltersPerField: enabled,
      },
      { reason: 'formattingOptionChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  // ===========================================================================
  // Calculated Fields
  // ===========================================================================

  addCalculatedField(
    pivotId: string,
    field: PivotCalculatedFieldSpec,
  ): Promise<PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }>;
  addCalculatedField(name: string, field: CalculatedField): Promise<void>;
  async addCalculatedField(
    pivotOrName: string,
    field: PivotCalculatedFieldSpec | CalculatedField,
  ): Promise<(PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }) | void> {
    const directConfig = await this.ctx.pivot.getPivot(this.sheetId, pivotOrName);
    if (directConfig) {
      const calculatedFieldId = pivotCalculatedFieldId(
        'calculatedFieldId' in field && field.calculatedFieldId
          ? field.calculatedFieldId
          : field.name,
      );
      const cleanedField: CalculatedField = {
        fieldId: 'fieldId' in field ? field.fieldId : calculatedFieldId,
        calculatedFieldId,
        name: field.name,
        formula: cleanPivotFormula(field.formula),
      };
      const result = await this.ctx.pivot.updatePivot(
        this.sheetId,
        pivotOrName,
        { calculatedFields: [...(directConfig.calculatedFields ?? []), cleanedField] },
        { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
      return {
        ...this.createMutationReceipt(
          pivotOrName,
          'calculatedFieldChanged',
          'refreshAndMaterialize',
          result,
          [{ type: 'calculatedFieldAdded', calculatedFieldId }],
        ),
        calculatedFieldId,
      };
    }

    const name = pivotOrName;
    const legacyField = field as CalculatedField;
    const pivotId = await this.resolveNameToId(name, 'addCalculatedField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'addCalculatedField');

    // Strip leading '=' — Excel formula syntax; the Rust engine expects bare expressions.
    const cleanedField: CalculatedField = {
      ...legacyField,
      formula: cleanPivotFormula(legacyField.formula),
    };

    const calculatedFields = [...(config.calculatedFields ?? []), cleanedField];

    // Also add a value placement so the calculated field appears in the Values zone
    // (readable by readPivot and queryPivot) and is included in the compute result.
    const existingPlacement = config.placements.find(
      (p) => p.fieldId === legacyField.fieldId && p.area === 'value',
    );
    let placements = config.placements;
    if (!existingPlacement) {
      const valuePlacements = config.placements.filter((p) => p.area === 'value');
      const newPlacement: PivotFieldPlacement = {
        placementId: makePlacementId('value', legacyField.fieldId, valuePlacements.length),
        fieldId: legacyField.fieldId,
        area: 'value',
        position: valuePlacements.length,
        aggregateFunction: 'sum',
        displayName: legacyField.name,
      };
      placements = [...config.placements, newPlacement];
    }

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { calculatedFields, placements },
      { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async addCalculatedFieldAndPlace(
    pivotId: string,
    field: PivotCalculatedFieldSpec,
    placement: Omit<PivotPlacementSpec, 'source' | 'fieldId'>,
  ): Promise<
    PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId; placementId: PlacementId }
  > {
    const config = await requirePivot(
      this.ctx,
      this.sheetId,
      pivotId,
      'addCalculatedFieldAndPlace',
    );
    const calculatedFieldId = pivotCalculatedFieldId(field.calculatedFieldId ?? field.name);
    const calculatedField: CalculatedField = {
      fieldId: calculatedFieldId,
      calculatedFieldId,
      name: field.name,
      formula: cleanPivotFormula(field.formula),
    };
    const position =
      placement.position ?? config.placements.filter((p) => p.area === placement.area).length;
    const placementId =
      placement.placementId ?? makePlacementId(placement.area, calculatedFieldId, position);
    const newPlacement: PivotFieldPlacement = {
      placementId,
      fieldId: calculatedFieldId,
      calculatedFieldId,
      area: placement.area,
      position,
      aggregateFunction:
        placement.aggregateFunction ?? (placement.area === 'value' ? 'sum' : undefined),
      sortOrder: placement.sortOrder === 'none' ? undefined : placement.sortOrder,
      displayName: placement.displayName,
      showValuesAs: placement.showValuesAs,
      numberFormat: placement.numberFormat,
    };
    const result = await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      {
        calculatedFields: [...(config.calculatedFields ?? []), calculatedField],
        placements: [...config.placements, newPlacement],
      },
      { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return {
      ...this.createMutationReceipt(
        pivotId,
        'calculatedFieldChanged',
        'refreshAndMaterialize',
        result,
        [
          { type: 'calculatedFieldAdded', calculatedFieldId },
          { type: 'placementAdded', placementId },
        ],
      ),
      calculatedFieldId,
      placementId,
    };
  }

  removeCalculatedField(
    pivotId: string,
    calculatedFieldId: CalculatedFieldId,
  ): Promise<PivotKernelMutationReceipt>;
  removeCalculatedField(name: string, fieldId: string): Promise<void>;
  async removeCalculatedField(
    pivotOrName: string,
    fieldId: string,
  ): Promise<PivotKernelMutationReceipt | void> {
    const directConfig = await this.ctx.pivot.getPivot(this.sheetId, pivotOrName);
    if (directConfig) {
      const calculatedFieldId = pivotCalculatedFieldId(fieldId);
      const calculatedFields = (directConfig.calculatedFields ?? []).filter(
        (f) => f.fieldId !== fieldId && f.calculatedFieldId !== calculatedFieldId,
      );
      const placements = directConfig.placements.filter(
        (p) => p.fieldId !== fieldId && p.calculatedFieldId !== calculatedFieldId,
      );
      const result = await this.ctx.pivot.updatePivot(
        this.sheetId,
        pivotOrName,
        { calculatedFields, placements },
        { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
      return this.createMutationReceipt(
        pivotOrName,
        'calculatedFieldChanged',
        'refreshAndMaterialize',
        result,
        [{ type: 'calculatedFieldRemoved', calculatedFieldId }],
      );
    }

    const name = pivotOrName;
    const pivotId = await this.resolveNameToId(name, 'removeCalculatedField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'removeCalculatedField');
    const calculatedFields = (config.calculatedFields ?? []).filter((f) => f.fieldId !== fieldId);
    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { calculatedFields },
      { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  updateCalculatedField(
    pivotId: string,
    calculatedFieldId: CalculatedFieldId,
    updates: Partial<Pick<PivotCalculatedFieldSpec, 'name' | 'formula'>>,
  ): Promise<PivotKernelMutationReceipt>;
  updateCalculatedField(
    name: string,
    fieldId: string,
    updates: Partial<Pick<CalculatedField, 'name' | 'formula'>>,
  ): Promise<void>;
  async updateCalculatedField(
    pivotOrName: string,
    fieldId: string,
    updates: Partial<Pick<CalculatedField, 'name' | 'formula'>>,
  ): Promise<PivotKernelMutationReceipt | void> {
    const directConfig = await this.ctx.pivot.getPivot(this.sheetId, pivotOrName);
    if (directConfig) {
      const calculatedFieldId = pivotCalculatedFieldId(fieldId);
      const normalizedUpdates = {
        ...updates,
        ...(updates.formula != null ? { formula: cleanPivotFormula(updates.formula) } : {}),
      };
      const calculatedFields = (directConfig.calculatedFields ?? []).map((f) =>
        f.fieldId === fieldId || f.calculatedFieldId === calculatedFieldId
          ? { ...f, ...normalizedUpdates }
          : f,
      );
      const result = await this.ctx.pivot.updatePivot(
        this.sheetId,
        pivotOrName,
        { calculatedFields },
        { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
      return this.createMutationReceipt(
        pivotOrName,
        'calculatedFieldChanged',
        'refreshAndMaterialize',
        result,
        [{ type: 'calculatedFieldUpdated', calculatedFieldId }],
      );
    }

    const name = pivotOrName;
    const pivotId = await this.resolveNameToId(name, 'updateCalculatedField');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'updateCalculatedField');
    const calculatedFields = (config.calculatedFields ?? []).map((f) =>
      f.fieldId === fieldId ? { ...f, ...updates } : f,
    );
    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { calculatedFields },
      { reason: 'calculatedFieldChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  // ===========================================================================
  // Sub-Range Access
  // ===========================================================================

  async getRange(name: string): Promise<CellRange | null> {
    const pivotId = await this.resolveNameToId(name, 'getRange');
    return this.getRangeForPivotId(pivotId);
  }

  private async getRangeForPivotId(pivotId: string): Promise<CellRange | null> {
    const bounds = await this.computeBounds(pivotId);
    if (!bounds) return null;
    const { config, totalRows, totalCols } = bounds;
    const startRow = config.outputLocation.row;
    const startCol = config.outputLocation.col;
    return {
      startRow,
      startCol,
      endRow: startRow + totalRows - 1,
      endCol: startCol + totalCols - 1,
      sheetId: this.sheetId,
    };
  }

  async getDataBodyRange(name: string): Promise<CellRange | null> {
    const pivotId = await this.resolveNameToId(name, 'getDataBodyRange');
    const bounds = await this.computeBounds(pivotId);
    if (!bounds) return null;
    const { config, totalRows, totalCols, firstDataRow, firstDataCol } = bounds;
    const startRow = config.outputLocation.row + firstDataRow;
    const startCol = config.outputLocation.col + firstDataCol;
    return {
      startRow,
      startCol,
      endRow: config.outputLocation.row + totalRows - 1,
      endCol: config.outputLocation.col + totalCols - 1,
      sheetId: this.sheetId,
    };
  }

  async getColumnLabelRange(name: string): Promise<CellRange | null> {
    const pivotId = await this.resolveNameToId(name, 'getColumnLabelRange');
    const bounds = await this.computeBounds(pivotId);
    if (!bounds) return null;
    const { config, totalCols, firstDataRow, firstDataCol } = bounds;
    if (firstDataRow === 0) return null; // No column headers
    const startRow = config.outputLocation.row;
    const startCol = config.outputLocation.col + firstDataCol;
    return {
      startRow,
      startCol,
      endRow: startRow + firstDataRow - 1,
      endCol: config.outputLocation.col + totalCols - 1,
      sheetId: this.sheetId,
    };
  }

  async getRowLabelRange(name: string): Promise<CellRange | null> {
    const pivotId = await this.resolveNameToId(name, 'getRowLabelRange');
    const bounds = await this.computeBounds(pivotId);
    if (!bounds) return null;
    const { config, totalRows, firstDataRow, firstDataCol } = bounds;
    if (firstDataCol === 0) return null; // No row labels
    const startRow = config.outputLocation.row + firstDataRow;
    const startCol = config.outputLocation.col;
    return {
      startRow,
      startCol,
      endRow: config.outputLocation.row + totalRows - 1,
      endCol: startCol + firstDataCol - 1,
      sheetId: this.sheetId,
    };
  }

  async getFilterAxisRange(name: string): Promise<CellRange | null> {
    const pivotId = await this.resolveNameToId(name, 'getFilterAxisRange');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'getFilterAxisRange');
    const filterPlacements = config.placements.filter((p) => p.area === 'filter');
    if (filterPlacements.length === 0) return null;
    // Filter area is rendered above the pivot table, one row per filter field,
    // starting 2 rows above the pivot anchor (row for label + row for dropdown each)
    const anchorRow = config.outputLocation.row;
    const anchorCol = config.outputLocation.col;
    const filterRowCount = filterPlacements.length;
    // Filter fields are placed above the pivot: each uses 1 row, label in col 0 + dropdown in col 1
    return {
      startRow: Math.max(0, anchorRow - filterRowCount * 2),
      startCol: anchorCol,
      endRow: anchorRow - 1,
      endCol: anchorCol + 1,
      sheetId: this.sheetId,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute rendered bounds from a PivotTableResult.
   * Derives totalRows, totalCols, firstDataRow, firstDataCol from the result structure.
   */
  private async computeBounds(pivotId: string): Promise<{
    config: DataPivotTableConfig;
    totalRows: number;
    totalCols: number;
    firstDataRow: number;
    firstDataCol: number;
  } | null> {
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'computeBounds');

    // Compute (uses cache if available)
    const result: PivotTableResult | null = await this.ctx.pivot.compute(this.sheetId, pivotId);
    if (!result) return null;

    if (result.renderedBounds.totalRows > 0 && result.renderedBounds.totalCols > 0) {
      return {
        config,
        totalRows: result.renderedBounds.totalRows,
        totalCols: result.renderedBounds.totalCols,
        firstDataRow: result.renderedBounds.firstDataRow,
        firstDataCol: result.renderedBounds.firstDataCol,
      };
    }

    // Legacy fallback for older compute results without rendered bounds.
    const rowFieldCount = config.placements.filter((p) => p.area === 'row').length;
    const colFieldCount = config.placements.filter((p) => p.area === 'column').length;
    const valueFieldCount = config.placements.filter((p) => p.area === 'value').length;

    // firstDataCol = number of row header columns
    const firstDataCol = Math.max(rowFieldCount, 1);
    // firstDataRow = number of column header rows (one per column field, plus 1 for value header if multiple values)
    const firstDataRow = Math.max(colFieldCount, 1) + (valueFieldCount > 1 ? 1 : 0);

    // totalRows = column header rows + data rows (result.rows includes subtotals & grand totals)
    const totalRows = firstDataRow + result.rows.length;
    // totalCols = row label columns + data columns (from column headers)
    const dataColCount = result.rows.length > 0 ? result.rows[0].values.length : 0;
    const totalCols = firstDataCol + dataColCount;

    return { config, totalRows, totalCols, firstDataRow, firstDataCol };
  }

  private async findPivotsByName(name: string): Promise<DataPivotTableConfig[]> {
    let pivots: DataPivotTableConfig[];
    try {
      pivots = await this.ctx.pivot.getAllPivots(this.sheetId);
    } catch {
      return [];
    }
    return pivots.filter((p) => (p.name ?? p.id) === name);
  }

  private async findPivotByName(name: string): Promise<DataPivotTableConfig | undefined> {
    const matches = await this.findPivotsByName(name);
    if (matches.length > 1) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Pivot table name "${name}" is ambiguous; matching pivot IDs: ${matches
          .map((pivot) => pivot.id)
          .join(', ')}`,
      );
    }
    return matches[0];
  }

  private async resolvePivotName(
    name: string,
    operation: string,
  ): Promise<{ pivotId: string; config: DataPivotTableConfig }> {
    const config = await this.findPivotByName(name);
    if (!config) {
      throw new KernelError('COMPUTE_ERROR', `${operation}: Pivot table "${name}" not found`);
    }
    return { pivotId: config.id, config };
  }

  private placementId(placement: PivotFieldPlacement): string {
    return (
      placement.placementId ||
      makePlacementId(
        placement.area,
        placement.calculatedFieldId ?? placement.fieldId,
        placement.position,
      )
    );
  }

  private placementFieldName(config: DataPivotTableConfig, placement: PivotFieldPlacement): string {
    return (
      config.fields.find((field) => field.id === placement.fieldId)?.name ??
      config.calculatedFields?.find((field) => field.fieldId === placement.fieldId)?.name ??
      placement.fieldId
    );
  }

  private placementReadout(config: DataPivotTableConfig, placement: PivotFieldPlacement): any {
    return {
      ...placement,
      placementId: this.placementId(placement),
      fieldName: this.placementFieldName(config, placement),
    };
  }

  private resolvePlacement(
    config: DataPivotTableConfig,
    identifier: string,
    area: PivotFieldArea | null,
    operation: string,
  ): PivotFieldPlacement {
    const candidates = config.placements.filter((placement) => {
      if (area && placement.area !== area) return false;
      const placementId = this.placementId(placement);
      const fieldName = this.placementFieldName(config, placement);
      return (
        placementId === identifier ||
        placement.fieldId === identifier ||
        fieldName === identifier ||
        placement.displayName === identifier
      );
    });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      throw createPivotAmbiguousPlacementError({
        pivotName: config.name ?? config.id,
        identifier,
        operation,
        candidates: candidates.map((placement) => this.placementId(placement)),
      });
    }
    throw new KernelError(
      'COMPUTE_ERROR',
      `${operation}: Pivot placement "${identifier}" not found`,
    );
  }

  private createPlacementReceipt(
    pivotId: string,
    placementId: string,
    updateReason: string,
    refreshPolicy: 'dirtyOnly' | 'refreshAndMaterialize',
    mutationResult: unknown,
  ): PivotKernelMutationReceipt {
    return {
      kernelReceiptId: `${pivotId}:${updateReason}:${Date.now()}`,
      pivotId,
      effects: [{ type: 'placementUpdated', placementId: pivotPlacementId(placementId) }],
      mutationResult,
      updateReason,
      refreshPolicy,
      materialized: refreshPolicy === 'refreshAndMaterialize',
      configRevision: 0,
      status: 'applied',
    };
  }

  private createMutationReceipt(
    pivotId: string,
    updateReason: string,
    refreshPolicy: 'dirtyOnly' | 'refreshAndMaterialize',
    mutationResult: unknown,
    effects: PivotKernelMutationReceipt['effects'],
  ): PivotKernelMutationReceipt {
    return {
      kernelReceiptId: `${pivotId}:${updateReason}:${Date.now()}`,
      pivotId,
      effects,
      mutationResult,
      updateReason,
      refreshPolicy,
      materialized: refreshPolicy === 'refreshAndMaterialize',
      configRevision: 0,
      status: 'applied',
    };
  }

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
      resolvePlacement: (config, identifier, area, operation) =>
        this.resolvePlacement(config, identifier, area, operation),
      placementId: (placement) => this.placementId(placement),
      getRange: (pivotId) => this.getRangeForPivotId(pivotId),
      addCalculatedField: (pivotId, field) =>
        this.addCalculatedField(pivotId, field) as Promise<
          PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }
        >,
      setDataSource: (pivotId, dataSource) => this.setDataSourceForHandle(pivotId, dataSource),
    });
  }
}
