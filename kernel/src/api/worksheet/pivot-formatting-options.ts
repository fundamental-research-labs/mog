import type { SheetId } from '@mog-sdk/contracts/api';
import type { DocumentContext } from '../../context';
import { requirePivot, resolvePivotName } from './pivot-lookup';

export async function getPivotAllowMultipleFiltersPerField(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<boolean> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(
    ctx,
    sheetId,
    pivotName,
    'getAllowMultipleFiltersPerField',
  );
  const config = await requirePivot(ctx, sheetId, pivotId, 'getAllowMultipleFiltersPerField');
  return config.allowMultipleFiltersPerField ?? false;
}

export async function setPivotAllowMultipleFiltersPerField(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  allow: boolean;
}): Promise<void> {
  const { ctx, sheetId, pivotName, allow } = options;
  const { pivotId } = await resolvePivotName(
    ctx,
    sheetId,
    pivotName,
    'setAllowMultipleFiltersPerField',
  );
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { allowMultipleFiltersPerField: allow },
    { reason: 'formattingOptionChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function getPivotAutoFormat(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<boolean> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getAutoFormat');
  const config = await requirePivot(ctx, sheetId, pivotId, 'getAutoFormat');
  return config.autoFormat ?? true;
}

export async function setPivotAutoFormat(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  autoFormat: boolean;
}): Promise<void> {
  const { ctx, sheetId, pivotName, autoFormat } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'setAutoFormat');
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { autoFormat },
    { reason: 'formattingOptionChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function getPivotPreserveFormatting(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<boolean> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getPreserveFormatting');
  const config = await requirePivot(ctx, sheetId, pivotId, 'getPreserveFormatting');
  return config.preserveFormatting ?? true;
}

export async function setPivotPreserveFormatting(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  preserve: boolean;
}): Promise<void> {
  const { ctx, sheetId, pivotName, preserve } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'setPreserveFormatting');
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { preserveFormatting: preserve },
    { reason: 'formattingOptionChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}

export async function getPivotEnableMultipleFilterItems(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<boolean> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(
    ctx,
    sheetId,
    pivotName,
    'getEnableMultipleFilterItems',
  );
  const config = await requirePivot(ctx, sheetId, pivotId, 'getEnableMultipleFilterItems');
  return config.allowMultipleFiltersPerField ?? false;
}

export async function setPivotEnableMultipleFilterItems(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  enabled: boolean;
}): Promise<void> {
  const { ctx, sheetId, pivotName, enabled } = options;
  const { pivotId } = await resolvePivotName(
    ctx,
    sheetId,
    pivotName,
    'setEnableMultipleFilterItems',
  );
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { allowMultipleFiltersPerField: enabled },
    { reason: 'formattingOptionChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}
