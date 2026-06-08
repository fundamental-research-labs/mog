import type {
  PivotHandlePlacementSpec,
  PivotHandleInfo,
  PivotHandleInfoOptions,
  PivotTableInfo,
  PivotValueSortConfig,
  PivotTableConfig as ApiPivotTableConfig,
  PivotTableHandle,
  SheetId,
} from '@mog-sdk/contracts/api';
import type { CellRange, CellValue } from '@mog-sdk/contracts/core';
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
  valuePlacementWithAggregate,
} from '../../../domain/pivots/value-labels';
import { setPivotItemVisibilityForId } from '../../../domain/pivots/filters';
import { toA1 } from '../../internal/utils';
import type { HandleLiveness } from '../../lifecycle/handle-liveness';

type PivotFieldPlacement = PivotFieldPlacementFlat;
type ValueAggregation = 'sum' | 'count' | 'average' | 'max' | 'min';

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
  getRange: (pivotId: string) => Promise<CellRange | null>;
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
    const result = await ctx.pivot.updatePivot(sheetId, pivotId, updates, {
      reason,
      refreshPolicy: 'refreshAndMaterialize',
    });
    if (!result) {
      snapshots.markDeleted(pivotId);
      throw createPivotStaleHandleError({ operation: 'pivot.update', pivotId, sheetId });
    }
    snapshots.set(result);
    return result;
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
        ...(current.sourceRange ? { sourceRange: current.sourceRange } : {}),
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

    getConfig(): ApiPivotTableConfig {
      const current = currentConfig('getConfig');
      return toApiConfig(current, current.sourceSheetName ?? sourceSheetName);
    },

    async update(updates: Partial<Omit<DataPivotTableConfig, 'id' | 'createdAt'>>): Promise<void> {
      await updateCachedPivot(updates, 'uiConfigChanged');
    },

    async delete(): Promise<boolean> {
      assertLive('delete');
      const deleted = await ctx.pivot.deletePivot(sheetId, pivotId);
      if (deleted) {
        snapshots.markDeleted(pivotId);
      }
      return deleted;
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

    getRange(): Promise<CellRange | null> {
      assertLive('getRange');
      return getRange(pivotId);
    },

    async addField(
      field: string,
      area: 'row' | 'column' | 'filter',
      position?: number,
    ): Promise<void> {
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
      await updateCachedPivot(
        { placements: [...otherPlacements, ...areaPlacements] },
        'fieldPlacementChanged',
      );
    },

    async addValueField(
      field: string,
      aggregation: ValueAggregation,
      label?: string,
    ): Promise<void> {
      const current = await refreshCachedConfig('addValueField');
      const valuePlacements = current.placements.filter((p) => p.area === 'value');
      await updateCachedPivot(
        {
          placements: [
            ...current.placements,
            {
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
            },
          ],
        },
        'fieldPlacementChanged',
      );
    },

    async addPlacement(spec: PivotHandlePlacementSpec) {
      assertLive('addPlacement');
      const receipt = await ctx.pivot.addPlacement(pivotId, spec);
      await refreshCachedConfig('addPlacement');
      return receipt;
    },

    async removeField(fieldName: string, area?: PivotFieldArea): Promise<void> {
      const current = await refreshCachedConfig('removeField');
      await updateCachedPivot(
        {
          placements: current.placements.filter(
            (p) => p.fieldId !== fieldName || (area != null && p.area !== area),
          ),
        },
        'fieldPlacementChanged',
      );
    },

    async removePlacement(placementIdToRemove) {
      assertLive('removePlacement');
      const receipt = await ctx.pivot.removePlacement(
        pivotId,
        pivotPlacementId(placementIdToRemove),
      );
      await refreshCachedConfig('removePlacement');
      return receipt;
    },

    async moveField(
      fieldName: string,
      fromArea: PivotFieldArea,
      toArea: PivotFieldArea,
      toPosition: number,
    ): Promise<void> {
      const current = await refreshCachedConfig('moveField');
      const target = resolvePlacement(current, fieldName, fromArea, 'moveField');
      await ctx.pivot.movePlacement(
        pivotId,
        pivotPlacementId(placementId(target)),
        toArea,
        toPosition,
      );
      await refreshCachedConfig('moveField');
    },

    async movePlacement(placementIdToMove, toArea, toPosition) {
      assertLive('movePlacement');
      const receipt = await ctx.pivot.movePlacement(
        pivotId,
        pivotPlacementId(placementIdToMove),
        toArea,
        toPosition,
      );
      await refreshCachedConfig('movePlacement');
      return receipt;
    },

    async changeAggregation(
      valueFieldLabel: string,
      newAggregation: ValueAggregation,
    ): Promise<void> {
      const current = await refreshCachedConfig('changeAggregation');
      const target = resolvePlacement(current, valueFieldLabel, 'value', 'changeAggregation');
      await updateCachedPivot(
        {
          placements: current.placements.map((placement) =>
            placement === target
              ? valuePlacementWithAggregate({
                  config: current,
                  placement,
                  aggregateFunction: newAggregation as AggregateFunction,
                })
              : placement,
          ),
        },
        'aggregateFunctionChanged',
      );
    },

    async setPlacementAggregateFunction(placementIdToUpdate, aggregateFunction) {
      assertLive('setPlacementAggregateFunction');
      const receipt = await ctx.pivot.setAggregateFunction(
        pivotId,
        pivotPlacementId(placementIdToUpdate),
        aggregateFunction,
      );
      await refreshCachedConfig('setPlacementAggregateFunction');
      return receipt;
    },

    async renameValueField(currentLabel: string, newLabel: string): Promise<void> {
      const current = await refreshCachedConfig('renameValueField');
      const target = resolvePlacement(current, currentLabel, 'value', 'renameValueField');
      await updateCachedPivot(
        {
          placements: current.placements.map((placement) =>
            placement === target ? { ...placement, displayName: newLabel } : placement,
          ),
        },
        'aggregateFunctionChanged',
      );
    },

    async renameValuePlacement(placementIdToRename, displayName) {
      assertLive('renameValuePlacement');
      const receipt = await ctx.pivot.renameValuePlacement(
        pivotId,
        pivotPlacementId(placementIdToRename),
        displayName,
      );
      await refreshCachedConfig('renameValuePlacement');
      return receipt;
    },

    async refresh(): Promise<void> {
      assertLive('refresh');
      await ctx.pivot.refresh(sheetId, pivotId);
      await refreshCachedConfig('refresh');
    },

    getAllItems(): Promise<PivotFieldItems[]> {
      assertLive('getAllItems');
      return ctx.pivot.getAllPivotItems(sheetId, pivotId);
    },

    async setShowValuesAs(
      valueFieldLabel: string,
      showValuesAs: ShowValuesAsConfig | null,
    ): Promise<void> {
      const current = await refreshCachedConfig('setShowValuesAs');
      const target = resolvePlacement(current, valueFieldLabel, 'value', 'setShowValuesAs');
      await updateCachedPivot(
        {
          placements: current.placements.map((placement) =>
            placement === target
              ? { ...placement, showValuesAs: showValuesAs ?? undefined }
              : placement,
          ),
        },
        'showValuesAsChanged',
      );
    },

    async setSortOrder(fieldOrPlacement: string, sortOrder: SortOrder): Promise<void> {
      const current = await refreshCachedConfig('setSortOrder');
      const target = resolvePlacement(current, fieldOrPlacement, null, 'setSortOrder');
      await ctx.pivot.setSortOrder(pivotId, pivotPlacementId(placementId(target)), sortOrder);
      await refreshCachedConfig('setSortOrder');
    },

    async setPlacementSortOrder(placementIdToSort, sortOrder) {
      assertLive('setPlacementSortOrder');
      const receipt = await ctx.pivot.setSortOrder(
        pivotId,
        pivotPlacementId(placementIdToSort),
        sortOrder,
      );
      await refreshCachedConfig('setPlacementSortOrder');
      return receipt;
    },

    async setSortByValue(axisPlacementId, valuePlacementId, config: PivotValueSortConfig | null) {
      assertLive('setSortByValue');
      const receipt = await ctx.pivot.setSortByValue(
        pivotId,
        pivotPlacementId(axisPlacementId),
        pivotPlacementId(valuePlacementId),
        config,
      );
      await refreshCachedConfig('setSortByValue');
      return receipt;
    },

    async setFilter(fieldId: string, filter: Omit<PivotFilter, 'fieldId'>): Promise<void> {
      const current = await refreshCachedConfig('setFilter');
      await updateCachedPivot(
        {
          filters: [
            ...current.filters.filter((existing) => existing.fieldId !== fieldId),
            { ...filter, fieldId },
          ],
        },
        'filterChanged',
      );
    },

    async removeFilter(fieldId: string): Promise<void> {
      const current = await refreshCachedConfig('removeFilter');
      await updateCachedPivot(
        { filters: current.filters.filter((existing) => existing.fieldId !== fieldId) },
        'filterChanged',
      );
    },

    async setLayout(layout: Partial<PivotTableLayout>): Promise<void> {
      const current = currentConfig('setLayout');
      await updateCachedPivot({ layout: { ...current.layout, ...layout } }, 'layoutChanged');
    },

    async setStyle(style: Partial<PivotTableStyle>): Promise<void> {
      const current = currentConfig('setStyle');
      await updateCachedPivot({ style: { ...current.style, ...style } }, 'styleChanged');
    },

    async toggleExpanded(headerKey: string, isRow: boolean): Promise<boolean> {
      assertLive('toggleExpanded');
      return ctx.pivotExpansionProvider?.toggleExpanded(pivotId, headerKey, isRow, sheetId) ?? true;
    },

    async setAllExpanded(expanded: boolean): Promise<void> {
      assertLive('setAllExpanded');
      ctx.pivotExpansionProvider?.setAllExpanded(pivotId, expanded);
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

    async addCalculatedField(
      field: CalculatedField,
    ): Promise<PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }> {
      assertLive('addCalculatedField');
      const receipt = await addCalculatedField(pivotId, field);
      await refreshCachedConfig('addCalculatedField');
      return receipt;
    },

    getDataSourceType(): DataSourceType {
      assertLive('getDataSourceType');
      return 'range';
    },

    async setDataSource(dataSource: string): Promise<void> {
      assertLive('setDataSource');
      await setDataSource(pivotId, dataSource);
      await refreshCachedConfig('setDataSource');
    },

    async setItemVisibility(fieldId: string, visibleItems: Record<string, boolean>): Promise<void> {
      assertLive('setItemVisibility');
      await setPivotItemVisibilityForId({ ctx, sheetId, pivotId, fieldId, visibleItems });
      await refreshCachedConfig('setItemVisibility');
    },
  };
}
