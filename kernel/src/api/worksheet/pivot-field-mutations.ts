import type { SheetId } from '@mog-sdk/contracts/api';
import type {
  AggregateFunction,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotKernelMutationReceipt,
  ShowValuesAsConfig,
  SortOrder,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { makePlacementId, pivotPlacementId } from './pivot-identifiers';
import { requirePivot, resolvePivotName } from './pivot-lookup';
import { placementId, resolvePlacement } from './pivot-placements';
import { createPlacementReceipt } from './pivot-receipts';

type PivotFieldPlacement = PivotFieldPlacementFlat;
type PivotSortDirection = Exclude<SortOrder, 'none'>;

export async function addPivotField(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
  area: PivotFieldArea;
  placementOptions?: {
    position?: number;
    aggregateFunction?: AggregateFunction;
    sortOrder?: SortOrder;
    displayName?: string;
    showValuesAs?: ShowValuesAsConfig;
  };
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId, area, placementOptions } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'addField');
  const placements = [...config.placements];
  const areaItems = placements.filter((placement) => placement.area === area);
  const position = placementOptions?.position ?? areaItems.length;
  const aggregateFunction =
    placementOptions?.aggregateFunction ?? (area === 'value' ? 'sum' : undefined);

  placements.push({
    placementId: makePlacementId(area, fieldId, position),
    fieldId,
    area,
    position,
    aggregateFunction: aggregateFunction as AggregateFunction | undefined,
    sortOrder: placementOptions?.sortOrder === 'none' ? undefined : placementOptions?.sortOrder,
    displayName: placementOptions?.displayName,
    showValuesAs: placementOptions?.showValuesAs,
  });

  renumberArea(placements, area);

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { placements },
    { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function removePivotField(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
  area: PivotFieldArea;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId, area } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'removeField');
  const placements = config.placements.filter(
    (placement) => !(placement.fieldId === fieldId && placement.area === area),
  );
  renumberArea(placements, area);

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { placements },
    { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function movePivotField(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
  fromArea: PivotFieldArea;
  toArea: PivotFieldArea;
  toPosition: number;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId, fromArea, toArea, toPosition } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'moveField');
  const sourceIndex = config.placements.findIndex(
    (placement) => placement.fieldId === fieldId && placement.area === fromArea,
  );
  if (sourceIndex === -1) {
    throw new KernelError(
      'COMPUTE_ERROR',
      'moveFieldPlacement: Field placement not found in source area',
    );
  }

  const placements = [...config.placements];
  const [moved] = placements.splice(sourceIndex, 1);
  moved.area = toArea;
  moved.position = toPosition;

  const targetAreaItems = placements.filter((placement) => placement.area === toArea);
  if (toPosition >= targetAreaItems.length) {
    placements.push(moved);
  } else {
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

  renumberArea(placements, fromArea);
  if (fromArea !== toArea) {
    renumberArea(placements, toArea);
  }

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { placements },
    { reason: 'fieldPlacementChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function setPivotAggregateFunction(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  placementOrFieldId: string;
  aggregateFunction: AggregateFunction;
}): Promise<PivotKernelMutationReceipt> {
  const { ctx, sheetId, pivotName, placementOrFieldId, aggregateFunction } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'setAggregateFunction');
  const target = resolvePlacement(config, placementOrFieldId, 'value', 'setAggregateFunction');
  if (placementId(target) === placementOrFieldId) {
    return ctx.pivot.setAggregateFunction(
      pivotId,
      pivotPlacementId(placementOrFieldId),
      aggregateFunction,
    );
  }

  const placements = config.placements.map((placement) =>
    placement === target ? { ...placement, aggregateFunction } : placement,
  );
  const result = await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { placements },
    { reason: 'aggregateFunctionChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
  return createPlacementReceipt(
    pivotId,
    placementId(target),
    'aggregateFunctionChanged',
    'refreshAndMaterialize',
    result,
  );
}

export async function setPivotShowValuesAs(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  placementOrFieldId: string;
  showValuesAs: ShowValuesAsConfig | null;
}): Promise<PivotKernelMutationReceipt> {
  const { ctx, sheetId, pivotName, placementOrFieldId, showValuesAs } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'setShowValuesAs');
  const target = resolvePlacement(config, placementOrFieldId, 'value', 'setShowValuesAs');
  if (placementId(target) === placementOrFieldId) {
    return ctx.pivot.setShowValuesAs(
      pivotId,
      pivotPlacementId(placementOrFieldId),
      showValuesAs,
    );
  }

  const placements = config.placements.map((placement) =>
    placement === target ? { ...placement, showValuesAs: showValuesAs ?? undefined } : placement,
  );
  const result = await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { placements },
    { reason: 'showValuesAsChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
  return createPlacementReceipt(
    pivotId,
    placementId(target),
    'showValuesAsChanged',
    'refreshAndMaterialize',
    result,
  );
}

export async function setPivotSortOrder(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  placementOrFieldId: string;
  sortOrder: SortOrder | null;
}): Promise<PivotKernelMutationReceipt> {
  const { ctx, sheetId, pivotName, placementOrFieldId, sortOrder } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'setSortOrder');
  const target = resolvePlacement(config, placementOrFieldId, null, 'setSortOrder');
  if (target.area !== 'row' && target.area !== 'column') {
    throw new KernelError(
      'COMPUTE_ERROR',
      'setSortOrder: Pivot placement must be in the row or column area',
    );
  }
  if (placementId(target) === placementOrFieldId) {
    return ctx.pivot.setSortOrder(pivotId, pivotPlacementId(placementOrFieldId), sortOrder);
  }

  const sortDirection: PivotSortDirection | undefined =
    !sortOrder || sortOrder === 'none' ? undefined : sortOrder;
  const placements = config.placements.map((placement) =>
    placement === target ? { ...placement, sortOrder: sortDirection } : placement,
  );
  const result = await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { placements },
    { reason: 'sortOrderChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
  return createPlacementReceipt(
    pivotId,
    placementId(target),
    'sortOrderChanged',
    'refreshAndMaterialize',
    result,
  );
}

export async function resetPivotField(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'resetField');
  const placements = config.placements.map((placement) =>
    placement.fieldId === fieldId
      ? {
          placementId: placement.placementId,
          fieldId: placement.fieldId,
          calculatedFieldId: placement.calculatedFieldId,
          area: placement.area,
          position: placement.position,
        }
      : placement,
  );
  const filters = config.filters.filter((filter) => filter.fieldId !== fieldId);

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { placements },
    { reason: 'fieldReset', refreshPolicy: 'refreshAndMaterialize' },
  );
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { filters },
    { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

function renumberArea(placements: PivotFieldPlacement[], area: PivotFieldArea): void {
  let position = 0;
  for (const placement of placements) {
    if (placement.area === area) {
      placement.position = position++;
    }
  }
}
