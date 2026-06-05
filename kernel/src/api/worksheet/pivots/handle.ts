import type {
  PivotHandlePlacementSpec,
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

type PivotFieldPlacement = PivotFieldPlacementFlat;
type ValueAggregation = 'sum' | 'count' | 'average' | 'max' | 'min';

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
  addCalculatedField: (
    pivotId: string,
    field: CalculatedField,
  ) => Promise<PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }>;
  setDataSource: (pivotId: string, dataSource: string) => Promise<void>;
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
    addCalculatedField,
    setDataSource,
  } = options;
  const pivotId = pivotConfig.id ?? pivotConfig.name;
  let cachedConfig: DataPivotTableConfig = pivotConfig;

  const refreshCachedConfig = async (): Promise<void> => {
    const updated = await ctx.pivot.getPivot(sheetId, pivotId);
    if (updated) cachedConfig = updated;
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
  ): Promise<void> => {
    const result = await ctx.pivot.updatePivot(sheetId, pivotId, updates, {
      reason,
      refreshPolicy: 'refreshAndMaterialize',
    });
    if (result) cachedConfig = result;
  };

  return {
    getName(): string {
      return cachedConfig.name ?? pivotId;
    },

    getConfig(): ApiPivotTableConfig {
      return toApiConfig(cachedConfig, sourceSheetName);
    },

    async update(updates: Partial<Omit<DataPivotTableConfig, 'id' | 'createdAt'>>): Promise<void> {
      await updateCachedPivot(updates, 'uiConfigChanged');
    },

    async delete(): Promise<boolean> {
      return ctx.pivot.deletePivot(sheetId, pivotId);
    },

    subscribeResult(
      callback: (result: PivotTableResult | null, error?: string) => void,
    ): () => void {
      return ctx.pivot.subscribe(pivotId, (_pivotId, result, error) => callback(result, error));
    },

    compute(forceRefresh?: boolean): Promise<PivotTableResult | null> {
      return ctx.pivot.compute(sheetId, pivotId, forceRefresh);
    },

    getRange(): Promise<CellRange | null> {
      return getRange(pivotId);
    },

    async addField(
      field: string,
      area: 'row' | 'column' | 'filter',
      position?: number,
    ): Promise<void> {
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
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
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
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
              displayName: label ?? undefined,
            },
          ],
        },
        'fieldPlacementChanged',
      );
    },

    async addPlacement(spec: PivotHandlePlacementSpec) {
      const receipt = await ctx.pivot.addPlacement(pivotId, spec);
      await refreshCachedConfig();
      return receipt;
    },

    async removeField(fieldName: string, area?: PivotFieldArea): Promise<void> {
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
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
      const receipt = await ctx.pivot.removePlacement(
        pivotId,
        pivotPlacementId(placementIdToRemove),
      );
      await refreshCachedConfig();
      return receipt;
    },

    async moveField(
      fieldName: string,
      fromArea: PivotFieldArea,
      toArea: PivotFieldArea,
      toPosition: number,
    ): Promise<void> {
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
      const target = resolvePlacement(current, fieldName, fromArea, 'moveField');
      await ctx.pivot.movePlacement(
        pivotId,
        pivotPlacementId(placementId(target)),
        toArea,
        toPosition,
      );
      await refreshCachedConfig();
    },

    async movePlacement(placementIdToMove, toArea, toPosition) {
      const receipt = await ctx.pivot.movePlacement(
        pivotId,
        pivotPlacementId(placementIdToMove),
        toArea,
        toPosition,
      );
      await refreshCachedConfig();
      return receipt;
    },

    async changeAggregation(
      valueFieldLabel: string,
      newAggregation: ValueAggregation,
    ): Promise<void> {
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
      const target = resolvePlacement(current, valueFieldLabel, 'value', 'changeAggregation');
      await updateCachedPivot(
        {
          placements: current.placements.map((placement) =>
            placement === target
              ? { ...placement, aggregateFunction: newAggregation as AggregateFunction }
              : placement,
          ),
        },
        'aggregateFunctionChanged',
      );
    },

    async setPlacementAggregateFunction(placementIdToUpdate, aggregateFunction) {
      const receipt = await ctx.pivot.setAggregateFunction(
        pivotId,
        pivotPlacementId(placementIdToUpdate),
        aggregateFunction,
      );
      await refreshCachedConfig();
      return receipt;
    },

    async renameValueField(currentLabel: string, newLabel: string): Promise<void> {
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
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
      const receipt = await ctx.pivot.renameValuePlacement(
        pivotId,
        pivotPlacementId(placementIdToRename),
        displayName,
      );
      await refreshCachedConfig();
      return receipt;
    },

    async refresh(): Promise<void> {
      await ctx.pivot.refresh(sheetId, pivotId);
    },

    getAllItems(): Promise<PivotFieldItems[]> {
      return ctx.pivot.getAllPivotItems(sheetId, pivotId);
    },

    async setShowValuesAs(
      valueFieldLabel: string,
      showValuesAs: ShowValuesAsConfig | null,
    ): Promise<void> {
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
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
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
      const target = resolvePlacement(current, fieldOrPlacement, null, 'setSortOrder');
      await ctx.pivot.setSortOrder(pivotId, pivotPlacementId(placementId(target)), sortOrder);
      await refreshCachedConfig();
    },

    async setPlacementSortOrder(placementIdToSort, sortOrder) {
      const receipt = await ctx.pivot.setSortOrder(
        pivotId,
        pivotPlacementId(placementIdToSort),
        sortOrder,
      );
      await refreshCachedConfig();
      return receipt;
    },

    async setSortByValue(axisPlacementId, valuePlacementId, config: PivotValueSortConfig | null) {
      const receipt = await ctx.pivot.setSortByValue(
        pivotId,
        pivotPlacementId(axisPlacementId),
        pivotPlacementId(valuePlacementId),
        config,
      );
      await refreshCachedConfig();
      return receipt;
    },

    async setFilter(fieldId: string, filter: Omit<PivotFilter, 'fieldId'>): Promise<void> {
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
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
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
      await updateCachedPivot(
        { filters: current.filters.filter((existing) => existing.fieldId !== fieldId) },
        'filterChanged',
      );
    },

    async setLayout(layout: Partial<PivotTableLayout>): Promise<void> {
      await updateCachedPivot({ layout: { ...cachedConfig.layout, ...layout } }, 'layoutChanged');
    },

    async setStyle(style: Partial<PivotTableStyle>): Promise<void> {
      await updateCachedPivot({ style: { ...cachedConfig.style, ...style } }, 'styleChanged');
    },

    async toggleExpanded(headerKey: string, isRow: boolean): Promise<boolean> {
      return ctx.pivotExpansionProvider?.toggleExpanded(pivotId, headerKey, isRow, sheetId) ?? true;
    },

    async setAllExpanded(expanded: boolean): Promise<void> {
      ctx.pivotExpansionProvider?.setAllExpanded(pivotId, expanded);
    },

    async getExpansionState(): Promise<PivotExpansionState> {
      return (
        ctx.pivotExpansionProvider?.getExpansionState(pivotId) ?? {
          expandedRows: {},
          expandedColumns: {},
        }
      );
    },

    getDrillDownData(rowKey: string, columnKey: string): Promise<CellValue[][]> {
      return ctx.pivot.getDrillDownData(sheetId, pivotId, rowKey, columnKey);
    },

    addCalculatedField(
      field: CalculatedField,
    ): Promise<PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }> {
      return addCalculatedField(pivotId, field);
    },

    getDataSourceType(): DataSourceType {
      return 'range';
    },

    async setDataSource(dataSource: string): Promise<void> {
      await setDataSource(pivotId, dataSource);
      await refreshCachedConfig();
    },

    async setItemVisibility(fieldId: string, visibleItems: Record<string, boolean>): Promise<void> {
      const current = await ctx.pivot.getPivot(sheetId, pivotId);
      if (!current) return;
      const visibleKeys = Object.entries(visibleItems)
        .filter(([, visible]) => visible)
        .map(([key]) => key);
      const hiddenKeys = Object.entries(visibleItems)
        .filter(([, visible]) => !visible)
        .map(([key]) => key);
      const filters = current.filters.filter((filter) => filter.fieldId !== fieldId);
      if (hiddenKeys.length > 0) {
        filters.push(
          hiddenKeys.length <= visibleKeys.length
            ? ({ fieldId, excludeValues: hiddenKeys } as PivotFilter)
            : ({ fieldId, includeValues: visibleKeys } as PivotFilter),
        );
      }
      await updateCachedPivot({ filters }, 'filterChanged');
    },
  };
}
