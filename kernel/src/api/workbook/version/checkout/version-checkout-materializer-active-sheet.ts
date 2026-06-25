import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../../../context';
import { getOrder } from '../../../../domain/sheets/sheet-meta';

export type CheckoutActiveSheetStateProvider = {
  getActiveSheetId(): string;
  setActiveSheetId(id: string): void;
  reconcileSheetRuntimeState?(state: {
    activeSheetId: string;
    visibleSheetIds: readonly string[];
  }): void;
};

export async function reconcileCheckoutActiveSheet(input: {
  readonly ctx: DocumentContext;
  readonly stateProvider: CheckoutActiveSheetStateProvider;
}): Promise<void> {
  const order = await getOrder(input.ctx);
  if (order.length === 0) return;

  const active = input.stateProvider.getActiveSheetId();
  const activeId = active ? toSheetId(active) : null;
  const hiddenBySheetId = await readHiddenBySheetId(input.ctx, order);
  const visibleOrder = order.filter((id) => !hiddenBySheetId.get(id));
  const nextActive =
    activeId && order.includes(activeId) && !hiddenBySheetId.get(activeId)
      ? activeId
      : (visibleOrder[0] ?? order[0]);
  const nextActiveId = String(nextActive);
  input.stateProvider.reconcileSheetRuntimeState?.({
    activeSheetId: nextActiveId,
    visibleSheetIds: visibleOrder.map(String),
  });
  if (active !== nextActiveId) {
    input.stateProvider.setActiveSheetId(nextActiveId);
  }
}

async function readHiddenBySheetId(
  ctx: DocumentContext,
  order: readonly SheetId[],
): Promise<ReadonlyMap<SheetId, boolean>> {
  return new Map(
    await Promise.all(
      order.map(async (id) => [id, await ctx.computeBridge.isSheetHidden(id)] as const),
    ),
  );
}
