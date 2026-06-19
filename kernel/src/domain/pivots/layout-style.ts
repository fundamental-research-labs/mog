import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  PivotKernelMutationReceipt,
  PivotTableLayout,
  PivotTableStyle,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { pivotStyleIdForCompute } from './style-normalization';
import { requirePivot, resolvePivotName } from './lookup';
import { createMutationReceipt } from './receipts';

export type PivotRefreshPolicy = 'dirtyOnly' | 'refreshAndMaterialize';

export function pivotLayoutStyleRefreshPolicy(config: {
  fields?: readonly unknown[];
}): PivotRefreshPolicy {
  return config.fields && config.fields.length > 0 ? 'refreshAndMaterialize' : 'dirtyOnly';
}

export async function setPivotLayoutByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  layout: Partial<PivotTableLayout>;
}): Promise<PivotKernelMutationReceipt> {
  const { ctx, sheetId, pivotName, layout } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'setLayout');
  return setPivotLayoutForId({ ctx, sheetId, pivotId, pivotName, layout });
}

export async function setPivotLayoutForId(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
  pivotName: string;
  layout: Partial<PivotTableLayout>;
}): Promise<PivotKernelMutationReceipt> {
  const { ctx, sheetId, pivotId, pivotName, layout } = options;
  const config = await requirePivot(ctx, sheetId, pivotId, 'setLayout');
  const mergedLayout = { ...config.layout, ...layout };
  const refreshPolicy = pivotLayoutStyleRefreshPolicy(config);
  const result = await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { layout: mergedLayout },
    { reason: 'layoutChanged', refreshPolicy },
  );
  return createMutationReceipt(
    pivotId,
    'layoutChanged',
    refreshPolicy,
    { action: 'setLayout', pivotName, layout },
    [],
    { status: result ? 'applied' : 'noOp' },
  );
}

export async function setPivotStyleByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
  style: Partial<PivotTableStyle>;
}): Promise<void> {
  const { ctx, sheetId, pivotName, style } = options;
  const { pivotId, config } = await resolvePivotName(ctx, sheetId, pivotName, 'setStyle');
  const mergedStyle = {
    ...config.style,
    ...style,
    ...(style.styleName !== undefined
      ? { styleName: pivotStyleIdForCompute(style.styleName) ?? style.styleName }
      : {}),
  };
  const refreshPolicy = pivotLayoutStyleRefreshPolicy(config);
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { style: mergedStyle },
    { reason: 'styleChanged', refreshPolicy },
  );
}
