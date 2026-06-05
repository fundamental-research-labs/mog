import type { SheetId } from '@mog-sdk/contracts/api';
import type { PivotFilter } from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../../context';
import { requirePivot, resolvePivotName } from './lookup';

export async function setPivotFilterByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
  filter: Omit<PivotFilter, 'fieldId'>;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId, filter } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'setFilter');
  await setPivotFilterForId({ ctx, sheetId, pivotId, fieldId, filter });
}

export async function setPivotFilterForId(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
  fieldId: string;
  filter: Omit<PivotFilter, 'fieldId'>;
}): Promise<void> {
  const { ctx, sheetId, pivotId, fieldId, filter } = options;
  const config = await requirePivot(ctx, sheetId, pivotId, 'setFilter');
  const filters = config.filters.filter((candidate) => candidate.fieldId !== fieldId);
  filters.push({ ...filter, fieldId });

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { filters },
    { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function removePivotFilterByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'removeFilter');
  await removePivotFilterForId({ ctx, sheetId, pivotId, fieldId });
}

export async function removePivotFilterForId(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
  fieldId: string;
}): Promise<void> {
  const { ctx, sheetId, pivotId, fieldId } = options;
  const config = await requirePivot(ctx, sheetId, pivotId, 'removeFilter');
  const filters = config.filters.filter((filter) => filter.fieldId !== fieldId);

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { filters },
    { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function setPivotItemVisibilityByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  fieldId: string;
  visibleItems: Record<string, boolean>;
}): Promise<void> {
  const { ctx, sheetId, pivotName, fieldId, visibleItems } = options;
  const { pivotId, config } = await resolvePivotName(
    ctx,
    sheetId,
    pivotName,
    'setPivotItemVisibility',
  );
  const visibleKeys = Object.entries(visibleItems)
    .filter(([, visible]) => visible)
    .map(([key]) => key);
  const hiddenKeys = Object.entries(visibleItems)
    .filter(([, visible]) => !visible)
    .map(([key]) => key);
  const filters = config.filters.filter((filter) => filter.fieldId !== fieldId);

  if (hiddenKeys.length === 0) {
    // Leaving the filter removed makes every item visible.
  } else if (hiddenKeys.length <= visibleKeys.length) {
    filters.push({
      fieldId,
      excludeValues: hiddenKeys,
    } as PivotFilter);
  } else {
    filters.push({
      fieldId,
      includeValues: visibleKeys,
    } as PivotFilter);
  }

  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { filters },
    { reason: 'filterChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}
