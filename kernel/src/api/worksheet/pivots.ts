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
} from '@mog-sdk/contracts/api';
import { type CellRange, type CellValue, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  AggregateFunction,
  CalculatedField,
  CalculatedFieldId,
  DataSourceType,
  DetectedDataType,
  PivotDataHierarchyInfo,
  PivotExpansionState,
  PivotField,
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
  createPivotInvalidDataSourceError,
  createPivotUnresolvedFieldReferencesError,
  type PivotInvalidReference,
} from '../../errors';
import { parseCellRange, toA1 } from '../internal/utils';
import { pivotStyleIdForCompute } from '../../domain/pivots/style-normalization';

type PivotFieldPlacement = PivotFieldPlacementFlat;
type PivotCreateDataConfig = Omit<
  DataPivotTableConfig,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'
>;
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

// =============================================================================
// Simple Config → Data Config Conversion
// =============================================================================

/**
 * Check if a config object is the simple/ergonomic format (has `dataSource` field)
 * vs. the complex/wire format (has `sourceSheetName` field).
 */
function isSimpleConfig(config: Record<string, any>): boolean {
  return typeof config.dataSource === 'string' && !('sourceSheetName' in config);
}

/**
 * Parse a dataSource string like "Sheet1!A1:D100" or "'My Sheet'!A1:D100"
 * into separate sheet name and range components.
 */
function parseDataSource(dataSource: string): {
  sheetName: string;
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
} {
  const parsed = parseCellRange(dataSource);
  if (!parsed) {
    throw new KernelError(
      'API_INVALID_ADDRESS',
      `Invalid dataSource: "${dataSource}". Expected format: "SheetName!A1:D100"`,
    );
  }
  const sheetName = parsed.sheetName;
  if (!sheetName) {
    throw new KernelError(
      'API_INVALID_ADDRESS',
      `dataSource must include a sheet reference: "${dataSource}". Expected format: "SheetName!A1:D100"`,
    );
  }
  return {
    sheetName,
    range: {
      startRow: parsed.startRow,
      startCol: parsed.startCol,
      endRow: parsed.endRow,
      endCol: parsed.endCol,
    },
  };
}

async function resolveSourceSheetId(
  ctx: DocumentContext,
  pivotName: string,
  dataSource: string,
  sheetName: string,
): Promise<SheetId> {
  const sheetIds = await ctx.computeBridge.getAllSheetIds();
  for (const id of sheetIds) {
    const sid = toSheetId(id as string);
    const name = await ctx.computeBridge.getSheetName(sid);
    if (name === sheetName) {
      return sid;
    }
  }
  throw createPivotInvalidDataSourceError({
    pivotName,
    dataSource,
    reason: 'sourceSheetNotFound',
    sheetName,
  });
}

/**
 * Detect the data type of a cell value for field metadata.
 */
function detectCellDataType(value: CellValue): DetectedDataType {
  if (value == null || value === '') return 'empty';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

async function detectPivotFieldsForRange(
  ctx: DocumentContext,
  sourceSheetId: SheetId,
  sourceRange: DataPivotTableConfig['sourceRange'],
): Promise<PivotField[]> {
  const headerRange = await ctx.computeBridge.queryRange(
    sourceSheetId,
    sourceRange.startRow,
    sourceRange.startCol,
    sourceRange.startRow,
    sourceRange.endCol,
  );

  const dataRowRange =
    sourceRange.endRow > sourceRange.startRow
      ? await ctx.computeBridge.queryRange(
          sourceSheetId,
          sourceRange.startRow + 1,
          sourceRange.startCol,
          sourceRange.startRow + 1,
          sourceRange.endCol,
        )
      : { cells: [] };

  const headerCells = new Map<number, string>();
  for (const cell of headerRange.cells) {
    const name = cell.value != null ? String(cell.value) : `Column${cell.col + 1}`;
    headerCells.set(cell.col, name);
  }

  const dataTypes = new Map<number, DetectedDataType>();
  for (const cell of dataRowRange.cells) {
    dataTypes.set(cell.col, detectCellDataType(cell.value));
  }

  const fields: PivotField[] = [];
  for (let col = sourceRange.startCol; col <= sourceRange.endCol; col++) {
    fields.push({
      id: `col${col}`,
      name: headerCells.get(col) ?? `Column${col + 1}`,
      sourceColumn: col - sourceRange.startCol,
      dataType: dataTypes.get(col) ?? 'string',
    });
  }
  return fields;
}

function fieldsByName(fields: PivotField[]): Map<string, PivotField[]> {
  const byName = new Map<string, PivotField[]>();
  for (const field of fields) {
    const existing = byName.get(field.name);
    if (existing) {
      existing.push(field);
    } else {
      byName.set(field.name, [field]);
    }
  }
  return byName;
}

async function resolveExistingPivotSourceSheetId(
  ctx: DocumentContext,
  config: DataPivotTableConfig,
): Promise<SheetId | null> {
  if (config.sourceSheetId) {
    return toSheetId(config.sourceSheetId);
  }

  if (!config.sourceSheetName) {
    return null;
  }

  const sheetIds = await ctx.computeBridge.getAllSheetIds();
  for (const id of sheetIds) {
    const sid = toSheetId(id as string);
    const name = await ctx.computeBridge.getSheetName(sid);
    if (name === config.sourceSheetName) {
      return sid;
    }
  }
  return null;
}

async function effectivePivotFieldsForConfig(
  ctx: DocumentContext,
  config: DataPivotTableConfig,
): Promise<PivotField[]> {
  if (config.fields.length > 0) {
    return config.fields;
  }

  const sourceSheetId = await resolveExistingPivotSourceSheetId(ctx, config);
  if (!sourceSheetId) {
    return [];
  }

  return detectPivotFieldsForRange(ctx, sourceSheetId, config.sourceRange);
}

/**
 * Convert a simple/ergonomic PivotTableConfig (with dataSource, rowFields, etc.)
 * into the full DataPivotTableConfig that the Rust bridge expects.
 *
 * This resolves the type mismatch between the agent-friendly API types and the
 * internal wire format. The conversion:
 * 1. Parses dataSource ("Sheet1!A1:D100") → sourceSheetName + sourceRange
 * 2. Reads source headers to build field metadata (id, name, sourceColumn, dataType)
 * 3. Converts rowFields/columnFields/valueFields/filterFields → placements array
 */
async function convertSimpleToDataConfig(
  ctx: DocumentContext,
  simpleConfig: ApiPivotTableConfig,
  outputSheetName: string,
): Promise<PivotCreateDataConfig> {
  const { sheetName: sourceSheetName, range: sourceRange } = parseDataSource(
    simpleConfig.dataSource,
  );

  const sourceSheetId = await resolveSourceSheetId(
    ctx,
    simpleConfig.name,
    simpleConfig.dataSource,
    sourceSheetName,
  );
  const fields = await detectPivotFieldsForRange(ctx, sourceSheetId, sourceRange);
  const fieldByName = new Map(fields.map((field) => [field.name, field]));

  // Build placements from simple field arrays
  const placements: PivotFieldPlacement[] = [];

  // Helper to resolve a field name to its ID
  const resolveFieldId = (fieldName: string): string => {
    const field = fieldByName.get(fieldName);
    if (!field) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Field "${fieldName}" not found in source data headers. Available: ${[...fieldByName.keys()].join(', ')}`,
      );
    }
    return field.id;
  };

  // Row fields
  if (simpleConfig.rowFields) {
    for (let i = 0; i < simpleConfig.rowFields.length; i++) {
      const fieldId = resolveFieldId(simpleConfig.rowFields[i]);
      placements.push({
        placementId: makePlacementId('row', fieldId, i),
        fieldId,
        area: 'row',
        position: i,
      });
    }
  }

  // Column fields
  if (simpleConfig.columnFields) {
    for (let i = 0; i < simpleConfig.columnFields.length; i++) {
      const fieldId = resolveFieldId(simpleConfig.columnFields[i]);
      placements.push({
        placementId: makePlacementId('column', fieldId, i),
        fieldId,
        area: 'column',
        position: i,
      });
    }
  }

  // Value fields
  if (simpleConfig.valueFields) {
    for (let i = 0; i < simpleConfig.valueFields.length; i++) {
      const vf = simpleConfig.valueFields[i];
      const fieldId = resolveFieldId(vf.field);
      placements.push({
        placementId: makePlacementId('value', fieldId, i),
        fieldId,
        area: 'value',
        position: i,
        aggregateFunction: vf.aggregation as AggregateFunction,
        displayName: vf.label ?? undefined,
      });
    }
  }

  // Filter fields
  if (simpleConfig.filterFields) {
    for (let i = 0; i < simpleConfig.filterFields.length; i++) {
      const fieldId = resolveFieldId(simpleConfig.filterFields[i]);
      placements.push({
        placementId: makePlacementId('filter', fieldId, i),
        fieldId,
        area: 'filter',
        position: i,
      });
    }
  }

  // Parse target address if provided
  let outputLocation = { row: 0, col: 0 };
  if (simpleConfig.targetAddress) {
    const addr = parseCellRange(simpleConfig.targetAddress);
    if (addr) {
      outputLocation = { row: addr.startRow, col: addr.startCol };
    }
  }

  return {
    name: simpleConfig.name,
    sourceSheetName,
    sourceRange,
    outputSheetName: simpleConfig.targetSheet ?? outputSheetName,
    outputLocation,
    fields,
    placements,
    filters: [],
    ...(simpleConfig.allowMultipleFiltersPerField != null && {
      allowMultipleFiltersPerField: simpleConfig.allowMultipleFiltersPerField,
    }),
    ...(simpleConfig.autoFormat != null && { autoFormat: simpleConfig.autoFormat }),
    ...(simpleConfig.preserveFormatting != null && {
      preserveFormatting: simpleConfig.preserveFormatting,
    }),
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

    if (isSimpleConfig(config as Record<string, any>)) {
      // Convert simple/ergonomic config to wire format
      const sheetName = await this.ctx.computeBridge.getSheetName(this.sheetId);
      dataConfig = await convertSimpleToDataConfig(
        this.ctx,
        config as ApiPivotTableConfig,
        sheetName ?? '',
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

    if (isSimpleConfig(config as Record<string, any>)) {
      // Convert simple/ergonomic config to wire format
      // For addWithSheet, the output sheet will be created with the given name
      dataConfig = await convertSimpleToDataConfig(
        this.ctx,
        config as ApiPivotTableConfig,
        sheetName,
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

  async get(name: string): Promise<PivotTableHandle | null> {
    const pivot = await this.findPivotByName(name);
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
    pivotId: string,
    placementId: PlacementId,
    aggregateFunction: AggregateFunction,
  ): Promise<PivotKernelMutationReceipt>;
  setAggregateFunction(
    name: string,
    fieldId: string,
    aggregateFunction: AggregateFunction,
  ): Promise<void>;
  async setAggregateFunction(
    pivotOrName: string,
    placementOrFieldId: string,
    aggregateFunction: AggregateFunction,
  ): Promise<PivotKernelMutationReceipt | void> {
    const directConfig = await this.ctx.pivot.getPivot(this.sheetId, pivotOrName);
    if (
      directConfig?.placements.some(
        (placement) => this.placementId(placement) === placementOrFieldId,
      )
    ) {
      return this.ctx.pivot.setAggregateFunction(
        pivotOrName,
        pivotPlacementId(placementOrFieldId),
        aggregateFunction,
      );
    }

    const name = pivotOrName;
    const fieldId = placementOrFieldId;
    const pivotId = await this.resolveNameToId(name, 'setAggregateFunction');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'setAggregateFunction');
    const target = this.resolvePlacement(config, fieldId, 'value', 'setAggregateFunction');

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
    pivotId: string,
    placementId: PlacementId,
    showValuesAs: ShowValuesAsConfig | null,
  ): Promise<PivotKernelMutationReceipt>;
  setShowValuesAs(
    name: string,
    fieldId: string,
    showValuesAs: ShowValuesAsConfig | null,
  ): Promise<void>;
  async setShowValuesAs(
    pivotOrName: string,
    placementOrFieldId: string,
    showValuesAs: ShowValuesAsConfig | null,
  ): Promise<PivotKernelMutationReceipt | void> {
    const directConfig = await this.ctx.pivot.getPivot(this.sheetId, pivotOrName);
    if (
      directConfig?.placements.some(
        (placement) => this.placementId(placement) === placementOrFieldId,
      )
    ) {
      return this.ctx.pivot.setShowValuesAs(
        pivotOrName,
        pivotPlacementId(placementOrFieldId),
        showValuesAs,
      );
    }

    const name = pivotOrName;
    const fieldId = placementOrFieldId;
    const pivotId = await this.resolveNameToId(name, 'setShowValuesAs');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'setShowValuesAs');
    const target = this.resolvePlacement(config, fieldId, 'value', 'setShowValuesAs');
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
    pivotId: string,
    placementId: PlacementId,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt>;
  setSortOrder(name: string, fieldId: string, sortOrder: SortOrder): Promise<void>;
  async setSortOrder(
    pivotOrName: string,
    placementOrFieldId: string,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt | void> {
    const directConfig = await this.ctx.pivot.getPivot(this.sheetId, pivotOrName);
    if (
      directConfig?.placements.some(
        (placement) => this.placementId(placement) === placementOrFieldId,
      )
    ) {
      return this.ctx.pivot.setSortOrder(
        pivotOrName,
        pivotPlacementId(placementOrFieldId),
        sortOrder,
      );
    }

    const name = pivotOrName;
    const fieldId = placementOrFieldId;
    const pivotId = await this.resolveNameToId(name, 'setSortOrder');
    const config = await requirePivot(this.ctx, this.sheetId, pivotId, 'setSortOrder');

    const sortDirection: PivotSortDirection | undefined =
      !sortOrder || sortOrder === 'none' ? undefined : sortOrder;
    const placements = config.placements.map((p) =>
      p.fieldId === fieldId && (p.area === 'row' || p.area === 'column')
        ? { ...p, sortOrder: sortDirection }
        : p,
    );

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { placements },
      { reason: 'sortOrderChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
  }

  async setFilter(
    name: string,
    fieldId: string,
    filter: Omit<PivotFilter, 'fieldId'>,
  ): Promise<void> {
    const pivotId = await this.resolveNameToId(name, 'setFilter');
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
      effects: [{ type: 'layoutChanged' }],
      mutationResult: { action: 'setLayout', pivotName: name, layout },
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

  async compute(name: string, forceRefresh?: boolean): Promise<any> {
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

  async getDrillDownData(name: string, rowKey: string, columnKey: string): Promise<any[][]> {
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
    const { sheetName: sourceSheetName, range: sourceRange } = parseDataSource(dataSource);
    const sourceSheetId = await resolveSourceSheetId(this.ctx, name, dataSource, sourceSheetName);
    const fields = await detectPivotFieldsForRange(this.ctx, sourceSheetId, sourceRange);
    const newFieldsByName = fieldsByName(fields);
    const oldFields = await effectivePivotFieldsForConfig(this.ctx, config);
    const oldFieldsById = new Map(oldFields.map((field) => [field.id, field]));
    const calculatedFields = config.calculatedFields ?? [];
    const calculatedFieldKeys = (field: CalculatedField): string[] =>
      [field.fieldId, field.calculatedFieldId].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      );
    const calculatedFieldById = new Map<string, CalculatedField>();
    for (const field of calculatedFields) {
      for (const id of calculatedFieldKeys(field)) {
        calculatedFieldById.set(id, field);
      }
    }
    const calculatedFieldIds = new Set(calculatedFieldById.keys());
    const invalidReferences: PivotInvalidReference[] = [];

    const describeCandidates = (candidates: PivotField[]): string[] =>
      candidates.map((field) => `${field.id}:${field.name}@${field.sourceColumn ?? 0}`);

    const oldFieldName = (fieldId: string): string =>
      oldFieldsById.get(fieldId)?.name ?? calculatedFieldById.get(fieldId)?.name ?? fieldId;

    const resolveFieldId = (
      fieldId: string,
      kind: Exclude<
        PivotInvalidReference['kind'],
        'ambiguousDuplicateHeader' | 'calculatedFieldFormula'
      >,
      path: string,
      source: string,
      area?: string,
      identifier = oldFieldName(fieldId),
    ): string | null => {
      if (calculatedFieldIds.has(fieldId)) {
        return fieldId;
      }
      const fieldName = oldFieldName(fieldId);
      const candidates = newFieldsByName.get(fieldName) ?? [];
      if (candidates.length === 1) {
        return candidates[0].id;
      }
      if (candidates.length > 1) {
        invalidReferences.push({
          kind: 'ambiguousDuplicateHeader',
          path,
          source,
          identifier,
          fieldName,
          area,
          oldResolution: oldFieldsById.get(fieldId),
          newResolution: candidates,
          candidates: describeCandidates(candidates),
        });
      } else {
        invalidReferences.push({
          kind,
          path,
          source,
          fieldId,
          fieldName,
          area,
          identifier,
          oldResolution: oldFieldsById.get(fieldId),
        });
      }
      return null;
    };

    const invalidCalculatedFieldIds = new Set<string>();
    for (const calculatedField of calculatedFields) {
      for (const oldField of oldFields) {
        const escaped = oldField.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`\\b${escaped}\\b`).test(calculatedField.formula)) continue;
        const candidates = newFieldsByName.get(oldField.name) ?? [];
        if (candidates.length !== 1) {
          for (const id of calculatedFieldKeys(calculatedField)) {
            invalidCalculatedFieldIds.add(id);
          }
          invalidReferences.push({
            kind: 'calculatedFieldFormula',
            path: `calculatedFields.${calculatedField.calculatedFieldId ?? calculatedField.fieldId}`,
            source: 'calculatedFieldFormula',
            identifier: calculatedField.formula,
            fieldName: oldField.name,
            candidates: describeCandidates(candidates),
          });
        }
      }
    }

    const placements: PivotFieldPlacement[] = [];
    for (let index = 0; index < config.placements.length; index++) {
      const placement = config.placements[index];
      const path = `placements[${index}]`;
      const sortByValue = placement.sortByValue;
      const placementFieldId = placement.fieldId;
      const placementCalculatedFieldId = placement.calculatedFieldId;
      if (sortByValue?.valueFieldId) {
        resolveFieldId(
          sortByValue.valueFieldId,
          'sortByValueField',
          `${path}.sortByValue.valueFieldId`,
          'sortByValue',
          placement.area,
        );
      }
      const baseField = placement.showValuesAs?.baseField;
      if (baseField) {
        resolveFieldId(
          baseField,
          'showValuesAsBaseField',
          `${path}.showValuesAs.baseField`,
          'showValuesAs',
          placement.area,
        );
      }
      const invalidCalculatedFieldId =
        [placementFieldId, placementCalculatedFieldId].find(
          (id) => typeof id === 'string' && invalidCalculatedFieldIds.has(id),
        ) ?? null;
      if (invalidCalculatedFieldId) {
        invalidReferences.push({
          kind: 'calculatedField',
          path,
          source: 'placement',
          fieldId: invalidCalculatedFieldId,
          fieldName: oldFieldName(invalidCalculatedFieldId),
          area: placement.area,
          identifier:
            calculatedFieldById.get(invalidCalculatedFieldId)?.formula ??
            oldFieldName(invalidCalculatedFieldId),
        });
        continue;
      }

      const validCalculatedFieldId = [placementFieldId, placementCalculatedFieldId].find(
        (id) => typeof id === 'string' && calculatedFieldIds.has(id),
      );
      if (validCalculatedFieldId) {
        placements.push(placement);
        continue;
      }

      const mappedFieldId = resolveFieldId(
        placementFieldId,
        'placement',
        path,
        'placement',
        placement.area,
      );
      if (!mappedFieldId) continue;
      const mappedPlacement: PivotFieldPlacement = {
        ...placement,
        fieldId: mappedFieldId,
      };
      if (sortByValue?.valueFieldId) {
        const mappedValueFieldId = resolveFieldId(
          sortByValue.valueFieldId,
          'sortByValueField',
          `${path}.sortByValue.valueFieldId`,
          'sortByValue',
          placement.area,
        );
        if (mappedValueFieldId) {
          mappedPlacement.sortByValue = { ...sortByValue, valueFieldId: mappedValueFieldId };
        }
      }
      if (baseField && placement.showValuesAs) {
        const mappedBaseField = resolveFieldId(
          baseField,
          'showValuesAsBaseField',
          `${path}.showValuesAs.baseField`,
          'showValuesAs',
          placement.area,
        );
        if (mappedBaseField) {
          mappedPlacement.showValuesAs = { ...placement.showValuesAs, baseField: mappedBaseField };
        }
      }
      placements.push(mappedPlacement);
    }

    const filters: PivotFilter[] = [];
    for (let index = 0; index < config.filters.length; index++) {
      const filter = config.filters[index];
      const path = `filters[${index}]`;
      const topBottom = filter.topBottom;
      if (topBottom?.valueFieldId) {
        resolveFieldId(
          topBottom.valueFieldId,
          'topBottomValueField',
          `${path}.topBottom.valueFieldId`,
          'filter',
        );
      }
      const mappedFieldId = resolveFieldId(filter.fieldId, 'filterField', path, 'filter');
      if (!mappedFieldId) continue;
      const mappedFilter: PivotFilter = { ...filter, fieldId: mappedFieldId };
      if (topBottom?.valueFieldId) {
        const mappedValueFieldId = resolveFieldId(
          topBottom.valueFieldId,
          'topBottomValueField',
          `${path}.topBottom.valueFieldId`,
          'filter',
        );
        if (mappedValueFieldId) {
          mappedFilter.topBottom = { ...topBottom, valueFieldId: mappedValueFieldId };
        }
      }
      filters.push(mappedFilter);
    }

    if (invalidReferences.length > 0) {
      throw createPivotUnresolvedFieldReferencesError({
        pivotName: name,
        dataSource,
        invalidReferences,
      });
    }

    await this.ctx.pivot.updatePivot(
      this.sheetId,
      pivotId,
      { sourceSheetName, sourceRange, fields, placements, filters },
      { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
    );
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

  async setAggregateFunctionLegacy(
    name: string,
    fieldId: string,
    aggregateFunction: AggregateFunction,
  ): Promise<void> {
    await this.setAggregateFunction(name, fieldId, aggregateFunction);
  }

  async setShowValuesAsLegacy(
    name: string,
    fieldId: string,
    showValuesAs: ShowValuesAsConfig | null,
  ): Promise<void> {
    await this.setShowValuesAs(name, fieldId, showValuesAs);
  }

  async setSortOrderLegacy(name: string, fieldId: string, sortOrder: SortOrder): Promise<void> {
    await this.setSortOrder(name, fieldId, sortOrder);
  }

  async addCalculatedFieldLegacy(name: string, field: CalculatedField): Promise<void> {
    await this.addCalculatedField(name, field);
  }

  async removeCalculatedFieldLegacy(name: string, fieldId: string): Promise<void> {
    await this.removeCalculatedField(name, fieldId);
  }

  async updateCalculatedFieldLegacy(
    name: string,
    fieldId: string,
    updates: Partial<Pick<CalculatedField, 'name' | 'formula'>>,
  ): Promise<void> {
    await this.updateCalculatedField(name, fieldId, updates);
  }

  // ===========================================================================
  // Sub-Range Access
  // ===========================================================================

  async getRange(name: string): Promise<CellRange | null> {
    const pivotId = await this.resolveNameToId(name, 'getRange');
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

  private async findPivotByName(name: string): Promise<DataPivotTableConfig | undefined> {
    let pivots: DataPivotTableConfig[];
    try {
      pivots = await this.ctx.pivot.getAllPivots(this.sheetId);
    } catch {
      return undefined;
    }
    return pivots.find((p) => (p.name ?? p.id) === name);
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
    const ctx = this.ctx;
    const sheetId = this.sheetId;
    const pivotId = pivotConfig.id ?? pivotConfig.name;
    const self = this;

    // Cache the last-known config for synchronous getConfig().
    // The contract requires getConfig() to be sync, but our bridge is async.
    // We use the config snapshot we already have, and update it on mutations.
    let cachedConfig: DataPivotTableConfig = pivotConfig;

    return {
      // Expose the internal pivot ID so callers can pass it to addField, etc.
      id: pivotId,

      getName(): string {
        return pivotConfig.name ?? pivotId;
      },

      getConfig(): ApiPivotTableConfig {
        return dataConfigToApiConfig(cachedConfig, sourceSheetName);
      },

      addField(field: string, area: 'row' | 'column' | 'filter', position?: number): void {
        // Fire-and-forget: contract is sync, bridge is async
        void (async () => {
          const current = await ctx.pivot.getPivot(sheetId, pivotId);
          if (!current) return;
          // Work with placements array (data contract type)
          const areaPlacements = current.placements.filter((p) => p.area === area);
          const otherPlacements = current.placements.filter((p) => p.area !== area);
          const newPlacement: PivotFieldPlacement = {
            placementId: makePlacementId(area, field, position ?? areaPlacements.length),
            fieldId: field,
            area,
            position: position ?? areaPlacements.length,
          };
          if (position !== undefined) {
            areaPlacements.splice(position, 0, newPlacement);
            // Reindex positions
            areaPlacements.forEach((p, i) => {
              p.position = i;
            });
          } else {
            areaPlacements.push(newPlacement);
          }
          const placements = [...otherPlacements, ...areaPlacements];
          const result = await ctx.pivot.updatePivot(
            sheetId,
            pivotId,
            { placements },
            { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
          );
          if (result) cachedConfig = result;
        })();
      },

      addValueField(
        field: string,
        aggregation: 'sum' | 'count' | 'average' | 'max' | 'min',
        label?: string,
      ): void {
        void (async () => {
          const current = await ctx.pivot.getPivot(sheetId, pivotId);
          if (!current) return;
          const valuePlacements = current.placements.filter((p) => p.area === 'value');
          const newPlacement: PivotFieldPlacement = {
            placementId: makePlacementId('value', field, valuePlacements.length),
            fieldId: field,
            area: 'value',
            position: valuePlacements.length,
            aggregateFunction: aggregation,
            displayName: label ?? undefined,
          };
          const placements = [...current.placements, newPlacement];
          const result = await ctx.pivot.updatePivot(
            sheetId,
            pivotId,
            { placements },
            { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
          );
          if (result) cachedConfig = result;
        })();
      },

      removeField(fieldName: string): void {
        void (async () => {
          const current = await ctx.pivot.getPivot(sheetId, pivotId);
          if (!current) return;
          // Remove all placements matching this field
          const placements = current.placements.filter((p) => p.fieldId !== fieldName);
          const result = await ctx.pivot.updatePivot(
            sheetId,
            pivotId,
            { placements },
            { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
          );
          if (result) cachedConfig = result;
        })();
      },

      changeAggregation(
        valueFieldLabel: string,
        newAggregation: 'sum' | 'count' | 'average' | 'max' | 'min',
      ): void {
        void (async () => {
          const current = await ctx.pivot.getPivot(sheetId, pivotId);
          if (!current) return;
          const valuePlacements = current.placements.filter((p) => p.area === 'value');
          if (valuePlacements.length === 0) return;
          // Match by fieldId (valueFieldLabel maps to the field name)
          const placements = current.placements.map((p) => {
            if (p.area === 'value' && p.fieldId === valueFieldLabel) {
              return { ...p, aggregateFunction: newAggregation as AggregateFunction };
            }
            return p;
          });
          const result = await ctx.pivot.updatePivot(
            sheetId,
            pivotId,
            { placements },
            { reason: 'aggregateFunctionChanged', refreshPolicy: 'refreshAndMaterialize' },
          );
          if (result) cachedConfig = result;
        })();
      },

      renameValueField(currentLabel: string, newLabel: string): void {
        void (async () => {
          const current = await ctx.pivot.getPivot(sheetId, pivotId);
          if (!current) return;
          const valuePlacements = current.placements.filter(
            (p: PivotFieldPlacement) => p.area === 'value',
          );
          if (valuePlacements.length === 0) return;

          // Match by displayName first, then by generated label ("Sum of FieldName"),
          // then by fieldId as fallback
          const matchPlacement = (p: PivotFieldPlacement): boolean => {
            if (p.displayName === currentLabel) return true;
            // Generate the default label: "Agg of FieldName"
            const field = current.fields.find(
              (f: { id: string; name: string }) => f.id === p.fieldId,
            );
            const fieldName = field?.name ?? p.fieldId;
            const agg = p.aggregateFunction ?? 'sum';
            const aggLabel = agg.charAt(0).toUpperCase() + agg.slice(1);
            const defaultLabel = `${aggLabel} of ${fieldName}`;
            if (defaultLabel === currentLabel) return true;
            // Fallback: match by fieldId
            return p.fieldId === currentLabel;
          };

          const placements = current.placements.map((p: PivotFieldPlacement) => {
            if (p.area === 'value' && matchPlacement(p)) {
              return { ...p, displayName: newLabel };
            }
            return p;
          });
          const result = await ctx.pivot.updatePivot(
            sheetId,
            pivotId,
            { placements },
            { reason: 'aggregateFunctionChanged', refreshPolicy: 'refreshAndMaterialize' },
          );
          if (result) cachedConfig = result;
        })();
      },

      async refresh(): Promise<void> {
        await ctx.pivot.refresh(sheetId, pivotId);
      },

      async getAllItems(): Promise<PivotFieldItems[]> {
        return ctx.pivot.getAllPivotItems(sheetId, pivotId);
      },

      setShowValuesAs(valueFieldLabel: string, showValuesAs: ShowValuesAsConfig | null): void {
        void (async () => {
          const current = await ctx.pivot.getPivot(sheetId, pivotId);
          if (!current) return;
          const placements = current.placements.map((p: PivotFieldPlacement) => {
            if (
              p.area === 'value' &&
              (p.displayName === valueFieldLabel || p.fieldId === valueFieldLabel)
            ) {
              return { ...p, showValuesAs: showValuesAs ?? undefined };
            }
            return p;
          });
          const result = await ctx.pivot.updatePivot(
            sheetId,
            pivotId,
            { placements },
            { reason: 'showValuesAsChanged', refreshPolicy: 'refreshAndMaterialize' },
          );
          if (result) cachedConfig = result;
        })();
      },

      getDataSourceType(): DataSourceType {
        // Currently all pivot tables are backed by cell ranges.
        return 'range';
      },

      async setDataSource(dataSource: string): Promise<void> {
        await self.setDataSource(cachedConfig.name ?? cachedConfig.id, dataSource);
        const updated = await ctx.pivot.getPivot(sheetId, pivotId);
        if (updated) cachedConfig = updated;
      },

      setItemVisibility(fieldId: string, visibleItems: Record<string, boolean>): void {
        void (async () => {
          const current = await ctx.pivot.getPivot(sheetId, pivotId);
          if (!current) return;

          const visibleKeys = Object.entries(visibleItems)
            .filter(([, v]) => v)
            .map(([k]) => k);
          const hiddenKeys = Object.entries(visibleItems)
            .filter(([, v]) => !v)
            .map(([k]) => k);

          const filters = current.filters.filter((f: PivotFilter) => f.fieldId !== fieldId);
          if (hiddenKeys.length > 0) {
            if (hiddenKeys.length <= visibleKeys.length) {
              filters.push({ fieldId, excludeValues: hiddenKeys } as PivotFilter);
            } else {
              filters.push({ fieldId, includeValues: visibleKeys } as PivotFilter);
            }
          }

          const result = await ctx.pivot.updatePivot(
            sheetId,
            pivotId,
            { filters },
            { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
          );
          if (result) cachedConfig = result;
        })();
      },
    };
  }
}
