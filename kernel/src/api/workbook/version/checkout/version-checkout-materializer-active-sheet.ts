import type { SheetId } from '@mog-sdk/contracts/core';
import { sheetId } from '@mog-sdk/contracts/core';

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
  const activeId = active ? sheetId(active) : null;
  const hiddenBySheetId = await readHiddenBySheetId(input.ctx, order);
  const visibleOrder = order.filter((id) => !hiddenBySheetId.get(id));
  if (activeId && order.includes(activeId) && !hiddenBySheetId.get(activeId)) return;

  const nextActive = visibleOrder[0] ?? order[0];
  input.stateProvider.reconcileSheetRuntimeState?.({
    activeSheetId: String(nextActive),
    visibleSheetIds: visibleOrder.map(String),
  });
  input.stateProvider.setActiveSheetId(String(nextActive));
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
