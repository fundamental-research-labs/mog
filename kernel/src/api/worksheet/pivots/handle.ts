import type {
  PivotHandleCalculatedFieldReceipt,
  PivotHandleMutationKind,
  PivotHandlePlacementSpec,
  PivotHandleInfo,
  PivotHandleInfoOptions,
  PivotHandleMutationReceipt,
  PivotRefreshReceipt,
  PivotTableInfo,
  PivotValueSortConfig,
  PivotTableConfig as ApiPivotTableConfig,
  PivotTableHandle,
  SheetId,
  WorksheetRange,
} from '@mog-sdk/contracts/api';
import type { CellValue } from '@mog-sdk/contracts/core';
import type {
  AggregateFunction,
  CalculatedField,
  CalculatedFieldId,
  DataSourceType,
  PivotExpansionState,
  PivotFieldArea,
  PivotFieldItems,
  PivotFieldPlacementFlat,
  PivotFilter,
  PivotKernelMutationReceipt,
  PivotTableConfig as DataPivotTableConfig,
  PivotTableLayout,
  PivotTableResult,
  PivotTableStyle,
  ShowValuesAsConfig,
  SortOrder,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../../context';
import { createPivotStaleHandleError } from '../../../errors';
import {
  automaticPivotValueDisplayName,
  automaticPivotValuePlacementDisplayName,
  valuePlacementWithAggregate,
} from '../../../domain/pivots/value-labels';
import { setPivotItemVisibilityForId } from '../../../domain/pivots/filters';
import { pivotLayoutStyleRefreshPolicy } from '../../../domain/pivots/layout-style';
import { toA1 } from '../../internal/utils';
import type { HandleLiveness } from '../../lifecycle/handle-liveness';
import { toWorksheetRange } from '../public-ranges';
import {
  buildPivotHandleCalculatedFieldReceipt,
  buildPivotHandleDeleteReceipt,
  buildPivotHandleExpansionReceipt,
  buildPivotHandleKernelReceipt,
  buildPivotHandleMutationReceipt,
} from './handle-receipts';
import { buildPivotRefreshReceipt } from './receipts';

type PivotFieldPlacement = PivotFieldPlacementFlat;
type ValueAggregation = 'sum' | 'count' | 'average' | 'max' | 'min';
type PivotHandleConfigReadback = DataPivotTableConfig & {
  dataSource: string;
  rowFields: NonNullable<ApiPivotTableConfig['rowFields']>;
  columnFields: NonNullable<ApiPivotTableConfig['columnFields']>;
  valueFields: NonNullable<ApiPivotTableConfig['valueFields']>;
  filterFields: NonNullable<ApiPivotTableConfig['filterFields']>;
};

export interface PivotHandleSnapshotRegistry {
  get(pivotId: string): DataPivotTableConfig | undefined;
  set(config: DataPivotTableConfig): void;
  markDeleted(pivotId: string): void;
  require(pivotId: string, operation: string): DataPivotTableConfig;
  refresh(pivotId: string, operation: string): Promise<DataPivotTableConfig>;
}

export interface PivotHandleBuilderOptions {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotConfig: DataPivotTableConfig;
  sourceSheetName: string | null;
  toApiConfig: (
    config: DataPivotTableConfig,
    sourceSheetName: string | null,
  ) => ApiPivotTableConfig;
  makePlacementId: (
    area: PivotFieldArea,
    fieldId: string,
    position: number,
  ) => NonNullable<PivotFieldPlacement['placementId']>;
  pivotPlacementId: (id: string) => NonNullable<PivotFieldPlacement['placementId']>;
  resolvePlacement: (
    config: DataPivotTableConfig,
    identifier: string,
    area: PivotFieldArea | null,
    operation: string,
  ) => PivotFieldPlacement;
  placementId: (placement: PivotFieldPlacement) => string;
  getRange: (pivotId: string) => Promise<WorksheetRange | null>;
  getCollectionInfo: (config: DataPivotTableConfig) => Promise<PivotTableInfo>;
  addCalculatedField: (
    pivotId: string,
    field: CalculatedField,
  ) => Promise<PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }>;
  setDataSource: (pivotId: string, dataSource: string) => Promise<void>;
  snapshots: PivotHandleSnapshotRegistry;
  liveness?: HandleLiveness;
}

export function buildPivotTableHandle(options: PivotHandleBuilderOptions): PivotTableHandle {
  const {
    ctx,
    sheetId,
    pivotConfig,
    sourceSheetName,
    toApiConfig,
    makePlacementId,
    pivotPlacementId,
    resolvePlacement,
    placementId,
    getRange,
    getCollectionInfo,
    addCalculatedField,
    setDataSource,
    snapshots,
    liveness,
  } = options;
  const pivotId = pivotConfig.id ?? pivotConfig.name;
  snapshots.set(pivotConfig);
  const availableMethods = [
    'getName',
    'getInfo',
    'getConfig',
    'update',
    'delete',
    'subscribeResult',
    'compute',
    'getRange',
    'addField',
    'addValueField',
    'addPlacement',
    'removeField',
    'removePlacement',
    'moveField',
    'movePlacement',
    'changeAggregation',
    'setPlacementAggregateFunction',
    'renameValueField',
    'renameValuePlacement',
    'refresh',
    'getAllItems',
    'setShowValuesAs',
    'setSortOrder',
    'setPlacementSortOrder',
    'setSortByValue',
    'setFilter',
    'removeFilter',
    'setLayout',
    'setStyle',
    'toggleExpanded',
    'setAllExpanded',
    'getExpansionState',
    'getDrillDownData',
    'addCalculatedField',
    'setItemVisibility',
    'getDataSourceType',
    'setDataSource',
  ] as const;

  const assertLive = (operation: string): void => {
    liveness?.assertLive(`pivot.${operation}`);
  };

  const currentConfig = (operation: string): DataPivotTableConfig => {
    assertLive(operation);
    return snapshots.require(pivotId, operation);
  };

  const refreshCachedConfig = async (operation: string): Promise<DataPivotTableConfig> => {
    assertLive(operation);
    return snapshots.refresh(pivotId, operation);
  };

  const updateCachedPivot = async (
    updates: Partial<DataPivotTableConfig>,
    reason:
      | 'uiConfigChanged'
      | 'fieldPlacementChanged'
      | 'aggregateFunctionChanged'
      | 'showValuesAsChanged'
      | 'filterChanged'
      | 'layoutChanged'
      | 'styleChanged',
  ): Promise<DataPivotTableConfig> => {
    assertLive(`update.${reason}`);
    const refreshPolicy =
      reason === 'layoutChanged' || reason === 'styleChanged'
        ? pivotLayoutStyleRefreshPolicy(currentConfig(`update.${reason}`))
        : 'refreshAndMaterialize';
    const result = await ctx.pivot.updatePivot(sheetId, pivotId, updates, {
      reason,
      refreshPolicy,
    });
    if (!result) {
      snapshots.markDeleted(pivotId);
      throw createPivotStaleHandleError({ operation: 'pivot.update', pivotId, sheetId });
    }
    snapshots.set(result);
    return result;
  };

  const configReceipt = (input: {
    kind: PivotHandleMutationKind;
    config: DataPivotTableConfig;
    fieldId?: string;
    area?: PivotFieldArea;
    placement?: PivotFieldPlacement;
    details?: Record<string, unknown>;
  }): PivotHandleMutationReceipt =>
    buildPivotHandleMutationReceipt({
      kind: input.kind,
      sheetId,
      pivotId,
      config: input.config,
      fieldId: input.fieldId,
      area: input.area,
      placementId: input.placement?.placementId,
      placement: input.placement,
      details: input.details,
    });

  const placementsInArea = (
    placements: readonly PivotFieldPlacement[],
    area: PivotFieldArea,
  ): PivotFieldPlacement[] =>
    placements
      .map((placement, originalIndex) => ({ placement, originalIndex }))
      .filter(({ placement }) => placement.area === area)
      .sort(
        (left, right) =>
          left.placement.position - right.placement.position ||
          left.originalIndex - right.originalIndex,
      )
      .map(({ placement }) => ({ ...placement }));

  const renumberPlacements = (placements: PivotFieldPlacement[]): PivotFieldPlacement[] =>
    placements.map((placement, position) => ({ ...placement, position }));

  const clampPlacementPosition = (position: number, length: number): number => {
    if (!Number.isFinite(position)) return length;
    return Math.max(0, Math.min(Math.trunc(position), length));
  };

  const calculatedFieldIdFromSpec = (
    spec: PivotHandlePlacementSpec,
  ): CalculatedFieldId | undefined =>
    spec.source?.type === 'calculatedField' ? spec.source.calculatedFieldId : undefined;

  const fieldIdFromSpec = (spec: PivotHandlePlacementSpec): string | undefined =>
    spec.fieldId ??
    (spec.source?.type === 'field' ? spec.source.fieldId : undefined) ??
    calculatedFieldIdFromSpec(spec);

  const toStoredSortOrder = (sortOrder: SortOrder | undefined): PivotFieldPlacement['sortOrder'] =>
    sortOrder === 'none' ? undefined : sortOrder;

  const makeStablePlacementId = (
    area: PivotFieldArea,
    fieldId: string,
    position: number,
    existingPlacements: readonly PivotFieldPlacement[],
  ): NonNullable<PivotFieldPlacement['placementId']> => {
    const existing = new Set(existingPlacements.map((placement) => placementId(placement)));
    const base = `${pivotId}:${area}:${fieldId}:${position}`;
    const baseId = pivotPlacementId(base);
    if (!existing.has(baseId)) return baseId;

    let suffix = 1;
    while (existing.has(pivotPlacementId(`${base}:${suffix}`))) suffix += 1;
    return pivotPlacementId(`${base}:${suffix}`);
  };

  const buildAddedPlacement = (
    current: DataPivotTableConfig,
    spec: PivotHandlePlacementSpec,
  ): { placement: PivotFieldPlacement; placements: PivotFieldPlacement[] } => {
    const fieldId = fieldIdFromSpec(spec);
    if (!fieldId) throw new Error('pivot.handle.addPlacement requires a field source');

    const areaPlacements = placementsInArea(current.placements, spec.area);
    const position = clampPlacementPosition(
      spec.position ?? areaPlacements.length,
      areaPlacements.length,
    );
    const calculatedFieldId = calculatedFieldIdFromSpec(spec);
    const placement: PivotFieldPlacement = {
      placementId:
        spec.placementId ?? makeStablePlacementId(spec.area, fieldId, position, current.placements),
      fieldId,
      area: spec.area,
      position,
    };

    if (calculatedFieldId) placement.calculatedFieldId = calculatedFieldId;

    const aggregateFunction = spec.aggregateFunction ?? (spec.area === 'value' ? 'sum' : undefined);
    if (aggregateFunction) placement.aggregateFunction = aggregateFunction;

    const sortOrder = toStoredSortOrder(spec.sortOrder);
    if (sortOrder) placement.sortOrder = sortOrder;
    if (spec.displayName) placement.displayName = spec.displayName;
    if (spec.showValuesAs) placement.showValuesAs = spec.showValuesAs;
    if (spec.numberFormat) placement.numberFormat = spec.numberFormat;

    if (spec.area === 'value') {
      placement.displayName = automaticPivotValuePlacementDisplayName({
        config: current,
        placement,
        aggregateFunction,
        displayName: spec.displayName,
      });
    }

    areaPlacements.splice(position, 0, placement);
    return {
      placement,
      placements: [
        ...current.placements
          .filter((candidate) => candidate.area !== spec.area)
          .map((p) => ({ ...p })),
        ...renumberPlacements(areaPlacements),
      ],
    };
  };

  return {
    getName(): string {
      return currentConfig('getName').name ?? pivotId;
    },

    async getInfo(options?: PivotHandleInfoOptions): Promise<PivotHandleInfo> {
      const current = await refreshCachedConfig('getInfo');
      const apiConfig = toApiConfig(current, current.sourceSheetName ?? sourceSheetName);
      const collectionInfo = await getCollectionInfo(current);
      const includeRanges = options?.includeRanges ?? true;
      const outputLocation = current.outputLocation
        ? {
            row: current.outputLocation.row,
            col: current.outputLocation.col,
            a1: toA1(current.outputLocation.row, current.outputLocation.col),
          }
        : undefined;

      return {
        id: pivotId,
        name: current.name ?? pivotId,
        dataSource: apiConfig.dataSource,
        contentArea: collectionInfo.contentArea,
        ...(collectionInfo.location ? { location: collectionInfo.location } : {}),
        rowFields: collectionInfo.rowFields ?? [],
        columnFields: collectionInfo.columnFields ?? [],
        valueFields: collectionInfo.valueFields ?? [],
        filterFields: collectionInfo.filterFields ?? [],
        ...(current.sourceSheetName ? { sourceSheetName: current.sourceSheetName } : {}),
        ...(current.sourceRange ? { sourceRange: toWorksheetRange(current.sourceRange) } : {}),
        ...(current.outputSheetName ? { outputSheetName: current.outputSheetName } : {}),
        ...(outputLocation ? { outputLocation } : {}),
        fields: current.fields,
        placements: current.placements,
        filters: current.filters,
        ...(current.layout ? { layout: current.layout } : {}),
        ...(current.style ? { style: current.style } : {}),
        ...(includeRanges ? { renderedRange: await getRange(pivotId) } : {}),
        expansionState: ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
          expandedRows: {},
          expandedColumns: {},
        },
        dataSourceType: 'range',
        ...(options?.includeItems
          ? { items: await ctx.pivot.getAllPivotItems(sheetId, pivotId) }
          : {}),
        availableMethods: [...availableMethods],
      };
    },

    getConfig(): PivotHandleConfigReadback {
      const current = currentConfig('getConfig');
      const apiConfig = toApiConfig(current, current.sourceSheetName ?? sourceSheetName);
      return JSON.parse(
        JSON.stringify({
          ...current,
          rowFields: apiConfig.rowFields,
          columnFields: apiConfig.columnFields,
          valueFields: apiConfig.valueFields,
          filterFields: apiConfig.filterFields,
          dataSource: apiConfig.dataSource,
        }),
      ) as PivotHandleConfigReadback;
    },

    async update(
      updates: Partial<Omit<DataPivotTableConfig, 'id' | 'createdAt'>>,
    ): Promise<PivotHandleMutationReceipt> {
      const config = await updateCachedPivot(updates, 'uiConfigChanged');
      return configReceipt({
        kind: 'pivot.handle.update',
        config,
      });
    },

    async delete() {
      assertLive('delete');
      const deleted = (await ctx.pivot.deletePivot(sheetId, pivotId)) === true;
      if (deleted) {
        snapshots.markDeleted(pivotId);
      }
      return buildPivotHandleDeleteReceipt({
        sheetId,
        pivotId,
        deleted,
      });
    },

    subscribeResult(
      callback: (result: PivotTableResult | null, error?: string) => void,
    ): () => void {
      assertLive('subscribeResult');
      const unsubscribe = ctx.pivot.subscribe(pivotId, (_pivotId, result, error) =>
        callback(result, error),
      );
      let active = true;
      const stopLivenessListener = liveness?.onInvalidate(() => {
        if (!active) return;
        active = false;
        unsubscribe();
      });
      return () => {
        if (!active) return;
        active = false;
        stopLivenessListener?.();
        unsubscribe();
      };
    },

    compute(forceRefresh?: boolean): Promise<PivotTableResult | null> {
      assertLive('compute');
      return ctx.pivot.compute(sheetId, pivotId, forceRefresh);
    },

    getRange(): Promise<WorksheetRange | null> {
      assertLive('getRange');
      return getRange(pivotId);
    },

    async addField(
      field: string,
      area: 'row' | 'column' | 'filter',
      position?: number,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('addField');
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
        areaPlacements.forEach((placement, index) => {
          placement.position = index;
        });
      } else {
        areaPlacements.push(newPlacement);
      }
      const config = await updateCachedPivot(
        { placements: [...otherPlacements, ...areaPlacements] },
        'fieldPlacementChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.addField',
        config,
        fieldId: field,
        area,
        placement: newPlacement,
      });
    },

    async addValueField(
      field: string,
      aggregation: ValueAggregation,
      label?: string,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('addValueField');
      const valuePlacements = current.placements.filter((p) => p.area === 'value');
      const newPlacement: PivotFieldPlacement = {
        placementId: makePlacementId('value', field, valuePlacements.length),
        fieldId: field,
        area: 'value',
        position: valuePlacements.length,
        aggregateFunction: aggregation,
        displayName: automaticPivotValueDisplayName({
          config: current,
          fieldId: field,
          aggregateFunction: aggregation,
          displayName: label,
        }),
      };
      const config = await updateCachedPivot(
        {
          placements: [...current.placements, newPlacement],
        },
        'fieldPlacementChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.addValueField',
        config,
        fieldId: field,
        area: 'value',
        placement: newPlacement,
      });
    },

    async addPlacement(spec: PivotHandlePlacementSpec) {
      assertLive('addPlacement');
      const current = currentConfig('addPlacement');
      const { placement, placements } = buildAddedPlacement(current, spec);
      const config = await updateCachedPivot({ placements }, 'fieldPlacementChanged');
      return buildPivotHandleMutationReceipt({
        kind: 'pivot.handle.addPlacement',
        sheetId,
        pivotId,
        config,
        fieldId: placement.fieldId,
        area: placement.area,
        placementId: placement.placementId,
        placement,
      });
    },

    async removeField(
      fieldName: string,
      area?: PivotFieldArea,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('removeField');
      const config = await updateCachedPivot(
        {
          placements: current.placements.filter(
            (p) => p.fieldId !== fieldName || (area != null && p.area !== area),
          ),
        },
        'fieldPlacementChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.removeField',
        config,
        fieldId: fieldName,
        area,
      });
    },

    async removePlacement(placementIdToRemove) {
      assertLive('removePlacement');
      const receipt = await ctx.pivot.removePlacement(
        pivotId,
        pivotPlacementId(placementIdToRemove),
      );
      const config = await refreshCachedConfig('removePlacement');
      return buildPivotHandleKernelReceipt({
        kind: 'pivot.handle.removePlacement',
        sheetId,
        kernelReceipt: receipt,
        config,
        placementId: pivotPlacementId(placementIdToRemove),
      });
    },

    async moveField(
      fieldName: string,
      fromArea: PivotFieldArea,
      toArea: PivotFieldArea,
      toPosition: number,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('moveField');
      const target = resolvePlacement(current, fieldName, fromArea, 'moveField');
      const movedPlacementId = pivotPlacementId(placementId(target));
      const receipt = await ctx.pivot.movePlacement(pivotId, movedPlacementId, toArea, toPosition);
      const config = await refreshCachedConfig('moveField');
      const movedPlacement = config.placements.find((p) => placementId(p) === movedPlacementId) ?? {
        ...target,
        placementId: movedPlacementId,
        area: toArea,
        position: toPosition,
      };
      return buildPivotHandleKernelReceipt({
        kind: 'pivot.handle.moveField',
        sheetId,
        kernelReceipt: receipt,
        config,
        fieldId: fieldName,
        area: toArea,
        placementId: movedPlacementId,
        placement: movedPlacement,
      });
    },

    async movePlacement(placementIdToMove, toArea, toPosition) {
      assertLive('movePlacement');
      const receipt = await ctx.pivot.movePlacement(
        pivotId,
        pivotPlacementId(placementIdToMove),
        toArea,
        toPosition,
      );
      const config = await refreshCachedConfig('movePlacement');
      return buildPivotHandleKernelReceipt({
        kind: 'pivot.handle.movePlacement',
        sheetId,
        kernelReceipt: receipt,
        config,
        area: toArea,
        placementId: pivotPlacementId(placementIdToMove),
      });
    },

    async changeAggregation(
      valueFieldLabel: string,
      newAggregation: ValueAggregation,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('changeAggregation');
      const target = resolvePlacement(current, valueFieldLabel, 'value', 'changeAggregation');
      let updatedPlacement: PivotFieldPlacement = target;
      const config = await updateCachedPivot(
        {
          placements: current.placements.map((placement) => {
            if (placement !== target) return placement;
            updatedPlacement = valuePlacementWithAggregate({
              config: current,
              placement,
              aggregateFunction: newAggregation as AggregateFunction,
            });
            return updatedPlacement;
          }),
        },
        'aggregateFunctionChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.changeAggregation',
        config,
        fieldId: target.fieldId,
        area: 'value',
        placement: updatedPlacement,
      });
    },

    async setPlacementAggregateFunction(placementIdToUpdate, aggregateFunction) {
      assertLive('setPlacementAggregateFunction');
      const receipt = await ctx.pivot.setAggregateFunction(
        pivotId,
        pivotPlacementId(placementIdToUpdate),
        aggregateFunction,
      );
      const config = await refreshCachedConfig('setPlacementAggregateFunction');
      return buildPivotHandleKernelReceipt({
        kind: 'pivot.handle.setPlacementAggregateFunction',
        sheetId,
        kernelReceipt: receipt,
        config,
        placementId: pivotPlacementId(placementIdToUpdate),
      });
    },

    async renameValueField(
      currentLabel: string,
      newLabel: string,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('renameValueField');
      const target = resolvePlacement(current, currentLabel, 'value', 'renameValueField');
      const updatedPlacement: PivotFieldPlacement = { ...target, displayName: newLabel };
      const config = await updateCachedPivot(
        {
          placements: current.placements.map((placement) =>
            placement === target ? updatedPlacement : placement,
          ),
        },
        'aggregateFunctionChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.renameValueField',
        config,
        fieldId: target.fieldId,
        area: 'value',
        placement: updatedPlacement,
      });
    },

    async renameValuePlacement(placementIdToRename, displayName) {
      assertLive('renameValuePlacement');
      const receipt = await ctx.pivot.renameValuePlacement(
        pivotId,
        pivotPlacementId(placementIdToRename),
        displayName,
      );
      const config = await refreshCachedConfig('renameValuePlacement');
      return buildPivotHandleKernelReceipt({
        kind: 'pivot.handle.renameValuePlacement',
        sheetId,
        kernelReceipt: receipt,
        config,
        placementId: pivotPlacementId(placementIdToRename),
      });
    },

    async refresh(): Promise<PivotRefreshReceipt> {
      assertLive('refresh');
      let result: PivotTableResult | null = null;
      let error: unknown;
      try {
        result = await ctx.pivot.refresh(sheetId, pivotId);
      } catch (caught) {
        error = caught;
      }
      const current = await refreshCachedConfig('refresh');
      return buildPivotRefreshReceipt({
        sheetId,
        pivotId,
        config: current,
        result,
        materializationError: error,
      });
    },

    getAllItems(): Promise<PivotFieldItems[]> {
      assertLive('getAllItems');
      return ctx.pivot.getAllPivotItems(sheetId, pivotId);
    },

    async setShowValuesAs(
      valueFieldLabel: string,
      showValuesAs: ShowValuesAsConfig | null,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('setShowValuesAs');
      const target = resolvePlacement(current, valueFieldLabel, 'value', 'setShowValuesAs');
      const updatedPlacement: PivotFieldPlacement = {
        ...target,
        showValuesAs: showValuesAs ?? undefined,
      };
      const config = await updateCachedPivot(
        {
          placements: current.placements.map((placement) =>
            placement === target ? updatedPlacement : placement,
          ),
        },
        'showValuesAsChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.setShowValuesAs',
        config,
        fieldId: target.fieldId,
        area: 'value',
        placement: updatedPlacement,
      });
    },

    async setSortOrder(
      fieldOrPlacement: string,
      sortOrder: SortOrder,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('setSortOrder');
      const target = resolvePlacement(current, fieldOrPlacement, null, 'setSortOrder');
      const receipt = await ctx.pivot.setSortOrder(
        pivotId,
        pivotPlacementId(placementId(target)),
        sortOrder,
      );
      const config = await refreshCachedConfig('setSortOrder');
      return buildPivotHandleKernelReceipt({
        kind: 'pivot.handle.setSortOrder',
        sheetId,
        kernelReceipt: receipt,
        config,
        fieldId: target.fieldId,
        area: target.area,
        placementId: pivotPlacementId(placementId(target)),
        placement: target,
      });
    },

    async setPlacementSortOrder(placementIdToSort, sortOrder) {
      assertLive('setPlacementSortOrder');
      const receipt = await ctx.pivot.setSortOrder(
        pivotId,
        pivotPlacementId(placementIdToSort),
        sortOrder,
      );
      const config = await refreshCachedConfig('setPlacementSortOrder');
      return buildPivotHandleKernelReceipt({
        kind: 'pivot.handle.setPlacementSortOrder',
        sheetId,
        kernelReceipt: receipt,
        config,
        placementId: pivotPlacementId(placementIdToSort),
      });
    },

    async setSortByValue(axisPlacementId, valuePlacementId, config: PivotValueSortConfig | null) {
      assertLive('setSortByValue');
      const receipt = await ctx.pivot.setSortByValue(
        pivotId,
        pivotPlacementId(axisPlacementId),
        pivotPlacementId(valuePlacementId),
        config,
      );
      const updatedConfig = await refreshCachedConfig('setSortByValue');
      return buildPivotHandleKernelReceipt({
        kind: 'pivot.handle.setSortByValue',
        sheetId,
        kernelReceipt: receipt,
        config: updatedConfig,
        placementId: pivotPlacementId(axisPlacementId),
      });
    },

    async setFilter(
      fieldId: string,
      filter: Omit<PivotFilter, 'fieldId'>,
    ): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('setFilter');
      const config = await updateCachedPivot(
        {
          filters: [
            ...current.filters.filter((existing) => existing.fieldId !== fieldId),
            { ...filter, fieldId },
          ],
        },
        'filterChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.setFilter',
        config,
        fieldId,
        details: { filter },
      });
    },

    async removeFilter(fieldId: string): Promise<PivotHandleMutationReceipt> {
      const current = await refreshCachedConfig('removeFilter');
      const config = await updateCachedPivot(
        { filters: current.filters.filter((existing) => existing.fieldId !== fieldId) },
        'filterChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.removeFilter',
        config,
        fieldId,
      });
    },

    async setLayout(layout: Partial<PivotTableLayout>): Promise<PivotHandleMutationReceipt> {
      const current = currentConfig('setLayout');
      const config = await updateCachedPivot(
        { layout: { ...current.layout, ...layout } },
        'layoutChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.setLayout',
        config,
        details: { layout },
      });
    },

    async setStyle(style: Partial<PivotTableStyle>): Promise<PivotHandleMutationReceipt> {
      const current = currentConfig('setStyle');
      const config = await updateCachedPivot(
        { style: { ...current.style, ...style } },
        'styleChanged',
      );
      return configReceipt({
        kind: 'pivot.handle.setStyle',
        config,
        details: { style },
      });
    },

    async toggleExpanded(headerKey: string, isRow: boolean) {
      assertLive('toggleExpanded');
      const provider = ctx.pivotExpansionProvider;
      const expanded = provider?.toggleExpanded(pivotId, headerKey, isRow, sheetId) ?? true;
      return buildPivotHandleExpansionReceipt({
        kind: 'pivot.handle.toggleExpanded',
        sheetId,
        pivotId,
        expanded,
        applied: provider != null,
        headerKey,
        isRow,
      });
    },

    async setAllExpanded(expanded: boolean) {
      assertLive('setAllExpanded');
      const provider = ctx.pivotExpansionProvider;
      provider?.setAllExpanded(pivotId, expanded);
      return buildPivotHandleExpansionReceipt({
        kind: 'pivot.handle.setAllExpanded',
        sheetId,
        pivotId,
        expanded,
        applied: provider != null,
      });
    },

    async getExpansionState(): Promise<PivotExpansionState> {
      assertLive('getExpansionState');
      return (
        ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
          expandedRows: {},
          expandedColumns: {},
        }
      );
    },

    getDrillDownData(rowKey: string, columnKey: string): Promise<CellValue[][]> {
      assertLive('getDrillDownData');
      return ctx.pivot.getDrillDownData(sheetId, pivotId, rowKey, columnKey);
    },

    async addCalculatedField(field: CalculatedField): Promise<PivotHandleCalculatedFieldReceipt> {
      assertLive('addCalculatedField');
      const receipt = await addCalculatedField(pivotId, field);
      const config = await refreshCachedConfig('addCalculatedField');
      return buildPivotHandleCalculatedFieldReceipt({
        sheetId,
        kernelReceipt: receipt,
        config,
      });
    },

    getDataSourceType(): DataSourceType {
      assertLive('getDataSourceType');
      return 'range';
    },

    async setDataSource(dataSource: string): Promise<PivotHandleMutationReceipt> {
      assertLive('setDataSource');
      await setDataSource(pivotId, dataSource);
      const config = await refreshCachedConfig('setDataSource');
      return configReceipt({
        kind: 'pivot.handle.setDataSource',
        config,
        details: { dataSource },
      });
    },

    async setItemVisibility(
      fieldId: string,
      visibleItems: Record<string, boolean>,
    ): Promise<PivotHandleMutationReceipt> {
      assertLive('setItemVisibility');
      await setPivotItemVisibilityForId({ ctx, sheetId, pivotId, fieldId, visibleItems });
      const config = await refreshCachedConfig('setItemVisibility');
      return configReceipt({
        kind: 'pivot.handle.setItemVisibility',
        config,
        fieldId,
        details: { visibleItems },
      });
    },
  };
}
