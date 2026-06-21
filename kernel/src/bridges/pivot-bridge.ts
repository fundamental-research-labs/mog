/**
 * Pivot Bridge
 *
 * Connects the UI layer to the Rust pivot engine,
 * delegating transport to ComputeBridge.
 *
 * Handles:
 * - CRUD operations via ComputeBridge (Rust-backed)
 * - Computing pivot table results from source data via ComputeBridge
 * - Caching computed results
 * - Automatic recomputation on source data or config changes
 * - Providing source data via DocumentContext to the Rust engine
 *
 * All config state lives in Rust — the former PivotStore has been deleted.
 */

import type {
  ImportedPivotViewRecord,
  IPivotBridge,
  PivotCacheStats,
  PivotCreateSheetOptions,
} from '@mog-sdk/contracts/bridges';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  CellChangedEvent,
  CellsBatchChangedEvent,
  PivotEvent,
  PivotUpdateOptions,
} from '@mog-sdk/contracts/events';
import type {
  AggregateFunction as ApiAggregateFunction,
  PivotFieldArea as ApiPivotFieldArea,
  PivotExpansionState,
  PivotField,
  PivotFieldItems,
  PivotKernelMutationReceipt,
  PivotMemberKey,
  PivotPlacementMutationReceipt,
  PivotTableConfig,
  PivotTableResult,
  PlacementId,
  ShowValuesAsConfig as ApiShowValuesAsConfig,
  SortOrder,
} from '@mog-sdk/contracts/pivot';
import type { PivotTableConfig as ComputePivotTableConfig } from './compute/compute-types.gen';
import type { DocumentContext } from '../context/types';
import { getOrder as getSheetOrder } from '../domain/sheets/sheet-meta';
import {
  automaticPivotValuePlacementDisplayName,
  valuePlacementWithAggregate,
} from '../domain/pivots/value-labels';
import { createMutationReceipt } from '../domain/pivots/receipts';
import { extractMutationData } from './compute/compute-core';
import {
  toComputePivotConfig,
  toPublicImportedPivotViewRecord,
  toPublicPivotConfig,
  toPublicPivotField,
  toPublicPivotFieldItems,
  toPublicPivotTableResult,
} from './pivot-bridge-mappers';
import {
  clampPlacementPosition,
  createStablePlacementId,
  getBridgePlacementId,
  getPlacementCalculatedFieldId,
  normalizePlacementPatch,
  placementsInArea,
  pivotTupleKey,
  renumberPlacements,
  toPublicSortOrder,
  type PivotBridgeInternalPlacementPatch,
  type PivotBridgePlacementSpec,
  type PublicPivotPlacement,
} from './pivot-bridge-placement';
import {
  findPivotLocation,
  getDataFromRange,
  getPivotSourceData,
  pivotUsesSourceSheet,
  sourceChangesAffectPivot,
} from './pivot-bridge-source';

function buildPivotBridgeReceipt(
  pivotId: string,
  action: string,
  configRevision: number,
  placementId?: PlacementId,
): PivotKernelMutationReceipt {
  const effects: PivotKernelMutationReceipt['effects'] = placementId
    ? [{ type: action === 'addPlacement' ? 'placementAdded' : 'placementUpdated', placementId }]
    : [];
  return createMutationReceipt(pivotId, action, 'refreshAndMaterialize', { action }, effects, {
    configRevision,
  });
}

/**
 * Cached pivot table result with metadata.
 */
interface CachedPivotResult {
  result: PivotTableResult;
  configVersion: number;
  dataVersion: number;
  computedAt: number;
}

/**
 * Callback for pivot result updates.
 */
export type PivotResultCallback = (
  pivotId: string,
  result: PivotTableResult | null,
  error?: string,
) => void;

/**
 * Bridge between the Rust pivot engine and the UI layer.
 * Manages computation, caching, and reactive updates.
 *
 * All CRUD operations and computation delegate to Rust via ComputeBridge.
 *
 * The former PivotStore has been deleted — all config
 * state now lives in Rust.
 */
export class PivotBridge implements IPivotBridge {
  private ctx: DocumentContext;

  // Cache: pivotId -> cached result
  private cache: Map<string, CachedPivotResult> = new Map();

  // Version tracking for invalidation
  private configVersions: Map<string, number> = new Map();
  private dataVersions: Map<string, number> = new Map();

  // Subscribers for result updates
  private subscribers: Map<string, Set<PivotResultCallback>> = new Map();

  // Unsubscribe functions for event observation
  private eventUnsubscribes: (() => void)[] = [];

  constructor(ctx: DocumentContext) {
    this.ctx = ctx;

    this.setupObservers();
  }

  /**
   * Create a new pivot table on a sheet.
   * Delegates to Rust compute engine which generates the ID and timestamps.
   */
  async createPivot(config: PivotTableConfig): Promise<PivotTableConfig> {
    const computeConfig = toComputePivotConfig(config);
    const mutationHandler = this.ctx.computeBridge.getMutationHandler();
    const mutationResult = mutationHandler
      ? await mutationHandler.withPivotUpdateOptions(
          { reason: 'uiConfigChanged', refreshPolicy: 'dirtyOnly' },
          () => this.ctx.computeBridge.pivotCreate(computeConfig),
        )
      : await this.ctx.computeBridge.pivotCreate(computeConfig);
    const result = extractMutationData<ComputePivotTableConfig>(mutationResult);
    if (!result) {
      throw new Error('pivotCreate: no config returned in MutationResult.data');
    }
    const publicResult = toPublicPivotConfig(result);
    // Bump config version for cache invalidation
    const currentVersion = this.configVersions.get(publicResult.id) ?? 0;
    this.configVersions.set(publicResult.id, currentVersion + 1);
    return publicResult;
  }

  /**
   * Get a single pivot table by ID.
   */
  async getPivot(sheetId: SheetId, pivotId: string): Promise<PivotTableConfig | null> {
    const config = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
    return config ? toPublicPivotConfig(config) : null;
  }

  /**
   * Get all pivot tables displayed on a sheet.
   */
  async getAllPivots(sheetId: SheetId): Promise<PivotTableConfig[]> {
    const configs = await this.ctx.computeBridge.pivotGetAll(sheetId);
    return configs.map(toPublicPivotConfig);
  }

  async getImportedPivotViewRecords(sheetId: SheetId): Promise<ImportedPivotViewRecord[]> {
    const records = await this.ctx.computeBridge.pivotGetImportedViewRecords(sheetId);
    return records.map(toPublicImportedPivotViewRecord);
  }

  /**
   * Update a pivot table configuration by merging partial updates.
   *
   * The Rust bridge expects a full PivotTableConfig (whole-config replace),
   * so we fetch the existing config, merge the caller's partial updates,
   * and send the merged result.
   */
  async updatePivot(
    sheetId: SheetId,
    pivotId: string,
    updates: Partial<PivotTableConfig>,
    options: PivotUpdateOptions,
  ): Promise<PivotTableConfig | null> {
    // Fetch existing config so we can merge partial updates into a full config
    const existingCompute = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
    if (!existingCompute) {
      return null;
    }

    const existing = toPublicPivotConfig(existingCompute);
    const mergedConfig: PivotTableConfig = { ...existing, ...updates };
    const computeConfig = toComputePivotConfig(mergedConfig);

    const mutationHandler = this.ctx.computeBridge.getMutationHandler();
    if (options.refreshPolicy === 'refreshAndMaterialize') {
      const expansionState = this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
        expandedRows: {},
        expandedColumns: {},
      };
      const materialized = mutationHandler
        ? await mutationHandler.withPivotUpdateOptions(
            { ...options, refreshPolicy: 'dirtyOnly' },
            () =>
              this.ctx.computeBridge.pivotUpdateAndMaterialize(
                sheetId,
                pivotId,
                computeConfig,
                expansionState ?? null,
              ),
          )
        : await this.ctx.computeBridge.pivotUpdateAndMaterialize(
            sheetId,
            pivotId,
            computeConfig,
            expansionState ?? null,
          );

      const result = materialized.config ?? null;
      if (result) {
        const currentVersion = this.configVersions.get(pivotId) ?? 0;
        this.configVersions.set(pivotId, currentVersion + 1);
      }
      if (materialized.result) {
        const publicResult = toPublicPivotTableResult(materialized.result);
        this.cache.set(pivotId, {
          result: publicResult,
          configVersion: this.getConfigVersion(pivotId),
          dataVersion: this.getDataVersion(sheetId),
          computedAt: this.ctx.clock.now(),
        });
        this.notifySubscribers(pivotId, publicResult);
      }
      return result ? toPublicPivotConfig(result) : null;
    }

    const mutationResult = mutationHandler
      ? await mutationHandler.withPivotUpdateOptions(options, () =>
          this.ctx.computeBridge.pivotUpdate(sheetId, pivotId, computeConfig),
        )
      : await this.ctx.computeBridge.pivotUpdate(sheetId, pivotId, computeConfig);
    const result = extractMutationData<ComputePivotTableConfig | null>(mutationResult) ?? null;
    if (result) {
      // Bump config version for cache invalidation
      const currentVersion = this.configVersions.get(pivotId) ?? 0;
      this.configVersions.set(pivotId, currentVersion + 1);
    }
    return result ? toPublicPivotConfig(result) : null;
  }

  async addPlacement(
    pivotId: string,
    spec: PivotBridgePlacementSpec,
  ): Promise<PivotPlacementMutationReceipt> {
    const { sheetId, config } = await findPivotLocation(this.ctx, pivotId);
    const fieldId =
      spec.fieldId ??
      (spec.source?.type === 'field' ? spec.source.fieldId : undefined) ??
      getPlacementCalculatedFieldId(spec);
    if (!fieldId) throw new Error('addPlacement: fieldId is required');
    const areaPlacements = placementsInArea(config.placements, spec.area);
    const position = clampPlacementPosition(
      spec.position ?? areaPlacements.length,
      areaPlacements.length,
    );
    const placement: PublicPivotPlacement = {
      placementId:
        spec.placementId ??
        createStablePlacementId(pivotId, spec.area, fieldId, position, config.placements),
      fieldId,
      area: spec.area,
      position,
    };
    const calculatedField = getPlacementCalculatedFieldId(spec);
    if (calculatedField) {
      placement.calculatedFieldId = calculatedField;
    }
    const aggregateFunction = spec.aggregateFunction ?? (spec.area === 'value' ? 'sum' : undefined);
    if (aggregateFunction) {
      placement.aggregateFunction = aggregateFunction;
    }
    const sortOrder = toPublicSortOrder(spec.sortOrder);
    if (sortOrder) {
      placement.sortOrder = sortOrder;
    }
    if (spec.displayName) {
      placement.displayName = spec.displayName;
    }
    if (spec.area === 'value') {
      placement.displayName = automaticPivotValuePlacementDisplayName({
        config,
        placement,
        aggregateFunction,
        displayName: spec.displayName,
      });
    }
    if (spec.showValuesAs) {
      placement.showValuesAs = spec.showValuesAs;
    }
    if (spec.numberFormat) {
      placement.numberFormat = spec.numberFormat;
    }
    areaPlacements.splice(position, 0, placement);
    const placements = [
      ...config.placements.filter((p) => p.area !== spec.area).map((p) => ({ ...p })),
      ...renumberPlacements(areaPlacements),
    ];
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    const placementId = getBridgePlacementId(placement);
    return {
      ...buildPivotBridgeReceipt(
        pivotId,
        'addPlacement',
        this.getConfigVersion(pivotId),
        placementId,
      ),
      status: 'applied',
      placementId,
    };
  }

  async updatePlacement(
    pivotId: string,
    placementId: PlacementId,
    patch: PivotBridgeInternalPlacementPatch,
  ): Promise<PivotKernelMutationReceipt> {
    const { sheetId, config } = await findPivotLocation(this.ctx, pivotId);
    const normalizedPatch = normalizePlacementPatch(patch);
    const placements = config.placements.map((p) => {
      if (getBridgePlacementId(p) !== placementId) return p;
      if (normalizedPatch.aggregateFunction && p.area === 'value') {
        return {
          ...valuePlacementWithAggregate({
            config,
            placement: p,
            aggregateFunction: normalizedPatch.aggregateFunction,
          }),
          ...normalizedPatch,
        };
      }
      return { ...p, ...normalizedPatch };
    });
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return buildPivotBridgeReceipt(
      pivotId,
      'updatePlacement',
      this.getConfigVersion(pivotId),
      placementId,
    );
  }

  async removePlacement(
    pivotId: string,
    placementId: PlacementId,
  ): Promise<PivotKernelMutationReceipt> {
    const { sheetId, config } = await findPivotLocation(this.ctx, pivotId);
    const removed = config.placements.find((p) => getBridgePlacementId(p) === placementId);
    const placements = config.placements.filter((p) => getBridgePlacementId(p) !== placementId);
    if (removed) {
      let nextPosition = 0;
      for (const p of placements) {
        if (p.area === removed.area) p.position = nextPosition++;
      }
    }
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return {
      ...buildPivotBridgeReceipt(pivotId, 'removePlacement', this.getConfigVersion(pivotId)),
      effects: [{ type: 'placementRemoved', placementId }],
    };
  }

  async movePlacement(
    pivotId: string,
    placementId: PlacementId,
    toArea: ApiPivotFieldArea,
    toPosition: number,
  ): Promise<PivotKernelMutationReceipt> {
    const { sheetId, config } = await findPivotLocation(this.ctx, pivotId);
    const moving = config.placements.find((p) => getBridgePlacementId(p) === placementId);
    if (!moving) throw new Error(`Pivot placement "${placementId}" not found`);
    const remaining = config.placements.filter((p) => getBridgePlacementId(p) !== placementId);
    const targetPlacements = placementsInArea(remaining, toArea);
    const targetPosition = clampPlacementPosition(toPosition, targetPlacements.length);
    targetPlacements.splice(targetPosition, 0, {
      ...moving,
      placementId: moving.placementId ?? placementId,
      area: toArea,
      position: targetPosition,
    });

    const affectedAreas = new Set<ApiPivotFieldArea>([moving.area, toArea]);
    const placements = [
      ...remaining.filter((p) => !affectedAreas.has(p.area)).map((p) => ({ ...p })),
      ...(moving.area === toArea
        ? []
        : renumberPlacements(placementsInArea(remaining, moving.area))),
      ...renumberPlacements(targetPlacements),
    ];
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
    );
    return buildPivotBridgeReceipt(
      pivotId,
      'movePlacement',
      this.getConfigVersion(pivotId),
      placementId,
    );
  }

  async setAggregateFunction(
    pivotId: string,
    placementId: PlacementId,
    aggregateFunction: ApiAggregateFunction,
  ): Promise<PivotKernelMutationReceipt> {
    return this.updatePlacement(pivotId, placementId, { aggregateFunction });
  }

  async setShowValuesAs(
    pivotId: string,
    placementId: PlacementId,
    showValuesAs: ApiShowValuesAsConfig | null,
  ): Promise<PivotKernelMutationReceipt> {
    return this.updatePlacement(pivotId, placementId, { showValuesAs: showValuesAs ?? undefined });
  }

  async renameValuePlacement(
    pivotId: string,
    placementId: PlacementId,
    displayName: string | null,
  ): Promise<PivotKernelMutationReceipt> {
    return this.updatePlacement(pivotId, placementId, { displayName: displayName ?? undefined });
  }

  async setSortOrder(
    pivotId: string,
    placementId: PlacementId,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt> {
    return this.updatePlacement(pivotId, placementId, {
      sortOrder: !sortOrder || sortOrder === 'none' ? undefined : sortOrder,
    });
  }

  async setSortByValue(
    pivotId: string,
    axisPlacementId: PlacementId,
    valuePlacementId: PlacementId,
    config: { order: SortOrder; columnKey?: string } | null,
  ): Promise<PivotKernelMutationReceipt> {
    const { config: pivotConfig } = await findPivotLocation(this.ctx, pivotId);
    const axisPlacement = pivotConfig.placements.find(
      (placement) => getBridgePlacementId(placement) === axisPlacementId,
    );
    if (!axisPlacement) throw new Error(`Pivot placement "${axisPlacementId}" not found`);
    if (axisPlacement.area !== 'row' && axisPlacement.area !== 'column') {
      throw new Error('setSortByValue: Axis placement must be in the row or column area');
    }

    let sortByValue: PublicPivotPlacement['sortByValue'];
    if (config) {
      const valuePlacement = pivotConfig.placements.find(
        (placement) => getBridgePlacementId(placement) === valuePlacementId,
      );
      if (!valuePlacement) throw new Error(`Pivot placement "${valuePlacementId}" not found`);
      if (valuePlacement.area !== 'value') {
        throw new Error('setSortByValue: Value placement must be in the value area');
      }
      sortByValue = {
        valueFieldId: valuePlacement.fieldId,
        valuePlacementId,
        order: config.order === 'none' ? 'asc' : config.order,
        columnKey: config.columnKey,
        columnTupleKey: config.columnKey ? pivotTupleKey(config.columnKey) : undefined,
      };
    }

    return this.updatePlacement(pivotId, axisPlacementId, {
      sortByValue,
    });
  }

  async resetPlacement(
    pivotId: string,
    placementId: PlacementId,
  ): Promise<PivotKernelMutationReceipt> {
    const { sheetId, config } = await findPivotLocation(this.ctx, pivotId);
    const placements = config.placements.map((p) =>
      getBridgePlacementId(p) === placementId
        ? {
            placementId: p.placementId,
            fieldId: p.fieldId,
            calculatedFieldId: p.calculatedFieldId,
            area: p.area,
            position: p.position,
          }
        : p,
    );
    await this.updatePivot(
      sheetId,
      pivotId,
      { placements },
      { reason: 'fieldReset', refreshPolicy: 'refreshAndMaterialize' },
    );
    return buildPivotBridgeReceipt(
      pivotId,
      'resetPlacement',
      this.getConfigVersion(pivotId),
      placementId,
    );
  }

  async setExpansion(
    pivotId: string,
    axisPlacementId: PlacementId,
    _memberPath: PivotMemberKey[],
    expanded: boolean,
  ): Promise<PivotKernelMutationReceipt> {
    return {
      ...buildPivotBridgeReceipt(
        pivotId,
        'setExpansion',
        this.getConfigVersion(pivotId),
        axisPlacementId,
      ),
      mutationResult: { action: 'setExpansion', expanded },
    };
  }

  async toggleExpanded(
    sheetId: SheetId,
    pivotId: string,
    headerKey: string,
    isRow: boolean,
  ): Promise<boolean> {
    const provider = this.ctx.pivotExpansionProvider;
    if (!provider) return true;
    return provider.toggleExpanded(pivotId, headerKey, isRow, sheetId);
  }

  async setAllExpanded(pivotId: string, expanded: boolean): Promise<void> {
    this.ctx.pivotExpansionProvider?.setAllExpanded(pivotId, expanded);
  }

  async getExpansionState(pivotId: string): Promise<PivotExpansionState> {
    return (
      this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
        expandedRows: {},
        expandedColumns: {},
      }
    );
  }

  /**
   * Delete a pivot table.
   */
  async deletePivot(sheetId: SheetId, pivotId: string): Promise<boolean> {
    const mutationResult = await this.ctx.computeBridge.pivotDelete(sheetId, pivotId);
    const deleted = extractMutationData<boolean>(mutationResult) ?? false;
    if (deleted) {
      // Bump config version and clear cache for the deleted pivot
      const currentVersion = this.configVersions.get(pivotId) ?? 0;
      this.configVersions.set(pivotId, currentVersion + 1);
      this.cache.delete(pivotId);
    }
    return deleted;
  }

  /**
   * Atomically create a new sheet AND a pivot table on it.
   * Both operations happen in a single transaction for undo atomicity.
   */
  async createPivotWithSheet(
    sheetName: string,
    config: PivotTableConfig,
    options?: PivotCreateSheetOptions,
  ): Promise<{ sheetId: SheetId; config: PivotTableConfig }> {
    const computeConfig = toComputePivotConfig(config);
    const mutationHandler = this.ctx.computeBridge.getMutationHandler();
    const result = mutationHandler
      ? await mutationHandler.withPivotUpdateOptions(
          { reason: 'uiConfigChanged', refreshPolicy: 'dirtyOnly' },
          () => this.ctx.computeBridge.pivotCreateWithSheet(sheetName, computeConfig, options),
        )
      : await this.ctx.computeBridge.pivotCreateWithSheet(sheetName, computeConfig, options);
    const publicConfig = toPublicPivotConfig(result.config);
    // Bump config version for cache invalidation
    const currentVersion = this.configVersions.get(publicConfig.id) ?? 0;
    this.configVersions.set(publicConfig.id, currentVersion + 1);
    return { sheetId: result.sheetId, config: publicConfig };
  }

  /**
   * Compute a pivot table result without materializing sheet/overlay output.
   * Uses cached pure-read results if available and valid.
   */
  async compute(
    sheetId: SheetId,
    pivotId: string,
    forceRefresh: boolean = false,
  ): Promise<PivotTableResult | null> {
    const configVersion = this.getConfigVersion(pivotId);
    const dataVersion = this.getDataVersion(sheetId);

    // Check cache validity
    if (!forceRefresh) {
      const cached = this.cache.get(pivotId);
      if (cached && cached.configVersion === configVersion && cached.dataVersion === dataVersion) {
        return cached.result;
      }
    }

    // Get expansion state from the provider (fallback: all expanded)
    const expansionState = this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
      expandedRows: {},
      expandedColumns: {},
    };

    // Pure compute via Rust engine. This is a read path: it must not materialize
    // output cells, clear dirty state, or notify subscribers with refreshed UI state.
    try {
      const result = toPublicPivotTableResult(
        await this.ctx.computeBridge.pivotComputeFromSource(
          sheetId,
          pivotId,
          expansionState ?? null,
        ),
      );

      // Cache result
      this.cache.set(pivotId, {
        result,
        configVersion,
        dataVersion,
        computedAt: this.ctx.clock.now(),
      });

      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Compute all pivot tables in a sheet.
   */
  async computeAll(sheetId: SheetId): Promise<Map<string, PivotTableResult>> {
    const results = new Map<string, PivotTableResult>();
    const pivots = await this.ctx.computeBridge.pivotGetAll(sheetId);

    for (const config of pivots) {
      const result = await this.compute(sheetId, config.id);
      if (result) {
        results.set(config.id, result);
      }
    }

    return results;
  }

  /**
   * Refresh a pivot table by materializing fresh output through the production
   * write path.
   */
  async refresh(sheetId: SheetId, pivotId: string): Promise<PivotTableResult | null> {
    this.invalidateCache(pivotId);

    const expansionState = this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
      expandedRows: {},
      expandedColumns: {},
    };
    const configVersion = this.getConfigVersion(pivotId);
    const dataVersion = this.getDataVersion(sheetId);

    try {
      const result = toPublicPivotTableResult(
        await this.ctx.computeBridge.pivotMaterialize(sheetId, pivotId, expansionState ?? null),
      );

      this.cache.set(pivotId, {
        result,
        configVersion,
        dataVersion,
        computedAt: this.ctx.clock.now(),
      });
      this.notifySubscribers(pivotId, result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.notifySubscribers(pivotId, null, errorMessage);
      return null;
    }
  }

  /**
   * Refresh all pivot tables that depend on a sheet's data.
   */
  async refreshDependentPivots(
    sourceSheetId: SheetId,
    changes?: readonly { row: number; col: number }[],
  ): Promise<void> {
    // Increment data version for this sheet
    const currentVersion = this.dataVersions.get(sourceSheetId) ?? 0;
    this.dataVersions.set(sourceSheetId, currentVersion + 1);

    // Resolve name only for legacy configs that predate sourceSheetId.
    const sourceName = await this.ctx.computeBridge.getSheetName(sourceSheetId);

    // Find all pivot tables that use this sheet as source
    const sheetIds = await getSheetOrder(this.ctx);
    for (const sheetId of sheetIds) {
      const pivots = await this.ctx.computeBridge.pivotGetAll(sheetId);
      for (const pivot of pivots) {
        const publicPivot = toPublicPivotConfig(pivot);
        if (
          pivotUsesSourceSheet(publicPivot, sourceSheetId, sourceName) &&
          sourceChangesAffectPivot(changes, publicPivot)
        ) {
          await this.refresh(sheetId, pivot.id);
        }
      }
    }
  }

  async refreshAllPivots(): Promise<void> {
    const sheetIds = await this.ctx.computeBridge.getAllSheetIds();
    for (const sheetIdValue of sheetIds) {
      const sheetId = toSheetId(sheetIdValue as string);
      const pivots = await this.ctx.computeBridge.pivotGetAll(sheetId);
      for (const pivot of pivots) {
        await this.refresh(sheetId, pivot.id);
      }
    }
  }

  /**
   * Detect fields from source data range.
   */
  async detectFields(
    sourceSheetId: SheetId,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<PivotField[]> {
    const data = await getDataFromRange(this.ctx, sourceSheetId, range);
    if (!data || data.length === 0) {
      return [];
    }

    const fields = await this.ctx.computeBridge.pivotDetectFields(data);
    return fields.map(toPublicPivotField);
  }

  /**
   * Get source row indices for a pivot cell (drill-down).
   */
  async drillDown(
    sheetId: SheetId,
    pivotId: string,
    rowKey: string,
    columnKey: string,
  ): Promise<number[]> {
    const config = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
    if (!config) {
      return [];
    }
    if (!config.fields?.length || !config.placements?.length) {
      return [];
    }

    const data = await getPivotSourceData(this.ctx, toPublicPivotConfig(config));
    if (!data) {
      return [];
    }

    return this.ctx.computeBridge.pivotDrillDown(config, data, rowKey, columnKey);
  }

  /**
   * Get actual source rows for a pivot cell.
   */
  async getDrillDownData(
    sheetId: SheetId,
    pivotId: string,
    rowKey: string,
    columnKey: string,
  ): Promise<CellValue[][]> {
    const config = await this.ctx.computeBridge.pivotGet(sheetId, pivotId);
    if (!config) {
      return [];
    }
    if (!config.fields?.length || !config.placements?.length) {
      return [];
    }

    const data = await getPivotSourceData(this.ctx, toPublicPivotConfig(config));
    if (!data) {
      return [];
    }

    const indices = await this.drillDown(sheetId, pivotId, rowKey, columnKey);
    // indices are into data rows (excluding header), so offset by 1
    return indices.map((i) => data[i + 1]);
  }

  /**
   * Get pivot items for all placed non-value fields.
   * Delegates to Rust so item extraction uses the same source-data read and
   * field auto-detection path as pivot materialization.
   */
  async getAllPivotItems(sheetId: SheetId, pivotId: string): Promise<PivotFieldItems[]> {
    const expansionState = this.ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
      expandedRows: {},
      expandedColumns: {},
    };
    const items = await this.ctx.computeBridge.pivotGetAllItems(
      sheetId,
      pivotId,
      expansionState ?? null,
    );
    return items.flatMap((fieldItems) => {
      const converted = toPublicPivotFieldItems(fieldItems);
      return converted ? [converted] : [];
    });
  }

  /**
   * Subscribe to updates for a specific pivot table.
   */
  subscribe(pivotId: string, callback: PivotResultCallback): () => void {
    if (!this.subscribers.has(pivotId)) {
      this.subscribers.set(pivotId, new Set());
    }
    this.subscribers.get(pivotId)!.add(callback);

    return () => {
      const subs = this.subscribers.get(pivotId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(pivotId);
        }
      }
    };
  }

  /**
   * Get current cached result for a pivot table.
   */
  getCachedResult(pivotId: string): PivotTableResult | null {
    const cached = this.cache.get(pivotId);
    return cached?.result ?? null;
  }

  /**
   * Invalidate cache for a specific pivot table.
   */
  invalidateCache(pivotId: string): void {
    this.cache.delete(pivotId);
    const currentVersion = this.configVersions.get(pivotId) ?? 0;
    this.configVersions.set(pivotId, currentVersion + 1);
  }

  /**
   * Invalidate all cached results.
   */
  invalidateAllCache(): void {
    this.cache.clear();
    this.configVersions.clear();
    this.dataVersions.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): PivotCacheStats {
    const now = this.ctx.clock.now();
    const entries: Array<{ pivotId: string; computedAt: number; ageMs: number }> = [];

    this.cache.forEach((cached, pivotId) => {
      entries.push({
        pivotId,
        computedAt: cached.computedAt,
        ageMs: now - cached.computedAt,
      });
    });

    return { size: this.cache.size, entries };
  }

  private getConfigVersion(pivotId: string): number {
    return this.configVersions.get(pivotId) ?? 0;
  }

  private getDataVersion(sheetId: SheetId): number {
    return this.dataVersions.get(sheetId) ?? 0;
  }

  private setupObservers(): void {
    // Observe pivot config changes via EventBus (replaces former PivotStore.subscribe)
    const handlePivotChange = (event: PivotEvent) => {
      if (!('pivotId' in event) || !event.pivotId) return;

      this.invalidateCache(event.pivotId);

      if (event.type === 'pivot:deleted') return;

      const shouldMaterialize =
        event.type !== 'pivot:updated' || event.update.refreshPolicy === 'refreshAndMaterialize';
      if (!shouldMaterialize || !('outputSheetId' in event) || !event.outputSheetId) {
        return;
      }

      void this.refresh(toSheetId(event.outputSheetId as string), event.pivotId);
    };

    this.eventUnsubscribes.push(
      this.ctx.eventBus.on('pivot:created', handlePivotChange),
      this.ctx.eventBus.on('pivot:updated', handlePivotChange),
      this.ctx.eventBus.on('pivot:deleted', handlePivotChange),
      this.ctx.eventBus.on('cell:changed', (event: CellChangedEvent) => {
        void this.refreshDependentPivots(toSheetId(event.sheetId), [
          { row: event.row, col: event.col },
        ]);
      }),
      this.ctx.eventBus.on('cells:batch-changed', (event: CellsBatchChangedEvent) => {
        void this.refreshDependentPivots(toSheetId(event.sheetId), event.changes);
      }),
    );
  }

  private notifySubscribers(
    pivotId: string,
    result: PivotTableResult | null,
    error?: string,
  ): void {
    const subs = this.subscribers.get(pivotId);
    if (subs) {
      subs.forEach((callback) => callback(pivotId, result, error));
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.eventUnsubscribes.forEach((unsub) => unsub());
    this.eventUnsubscribes = [];
    this.cache.clear();
    this.subscribers.clear();
  }
}

// PivotBridge instances are managed by React context for proper lifecycle management.
