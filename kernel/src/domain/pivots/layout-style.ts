import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  PivotKernelMutationReceipt,
  PivotTableLayout,
  PivotTableStyle,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { pivotStyleIdForCompute } from './style-normalization';
import { requirePivot, resolvePivotName } from './lookup';

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
  const result = await ctx.pivot.updatePivot(
    sheetId,
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
  await ctx.pivot.updatePivot(
    sheetId,
    pivotId,
    { style: mergedStyle },
    { reason: 'styleChanged', refreshPolicy: 'refreshAndMaterialize' },
  );
}
