import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context';
import { getOrder } from '../../domain/sheets/sheet-meta';
import { createSheetNotFoundError } from '../internal/sheet-lookup-diagnostics';

export interface SheetLookupEntry {
  readonly id: SheetId;
  readonly name: string;
}

export async function resolveSheetTarget(
  ctx: DocumentContext,
  target: number | string,
): Promise<SheetId> {
  const order = await getOrder(ctx);

  if (typeof target === 'number') {
    if (target < 0 || target >= order.length) {
      throw createSheetNotFoundError({
        target,
        knownSheetNames: await getKnownSheetNames(ctx, order),
        context: {
          lookupKind: 'sheetIndex',
          sheetCount: order.length,
        },
      });
    }
    return order[target];
  }

  const entries = await getSheetLookupEntries(ctx, order);
  for (const { id, name } of entries) {
    if (name.toLowerCase() === target.toLowerCase()) return id;
  }

  const matchedId = order.find((id) => id === target);
  if (matchedId) return matchedId;

  throw createSheetNotFoundError({
    target,
    knownSheetNames: entries.map(({ name }) => name),
    context: {
      lookupKind: 'sheetName',
      knownSheetIds: order.map(String),
    },
  });
}

export async function resolveSheetNameToId(
  ctx: DocumentContext,
  nameLower: string,
): Promise<SheetId | undefined> {
  for (const { id, name } of await getSheetLookupEntries(ctx)) {
    if (name.toLowerCase() === nameLower) return id;
  }
  return undefined;
}

export async function getKnownSheetNames(
  ctx: DocumentContext,
  order?: readonly SheetId[],
): Promise<string[]> {
  return (await getSheetLookupEntries(ctx, order)).map(({ name }) => name);
}

export async function getSheetLookupEntries(
  ctx: DocumentContext,
  order?: readonly SheetId[],
): Promise<SheetLookupEntry[]> {
  const sheetOrder = order ?? (await getOrder(ctx));
  const entries = await Promise.all(
    sheetOrder.map(async (id) => {
      const name = await ctx.computeBridge.getSheetName(id);
      return name == null ? null : { id, name };
    }),
  );
  return entries.filter((entry): entry is SheetLookupEntry => entry != null);
}
