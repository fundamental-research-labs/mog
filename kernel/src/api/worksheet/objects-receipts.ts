import type {
  FloatingObjectCollectionRemoveReceipt,
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
  FloatingObjectRemoveReceipt,
  OperationEffect,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { FloatingObject, FloatingObjectKind } from '@mog-sdk/contracts/floating-objects';
import type { ObjectBounds } from '@mog-sdk/contracts/kernel';

import {
  createMinimalFloatingObject,
  toFloatingObject,
} from '../../bridges/compute/floating-object-mapper';
import type { DocumentContext } from '../../context';

const DEFAULT_BOUNDS: ObjectBounds = { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
type FloatingObjectReceiptBaseFields = 'kind' | 'status' | 'effects' | 'diagnostics' | 'sheetId';
type FloatingObjectMutationReceiptInput = Omit<
  FloatingObjectMutationReceipt,
  FloatingObjectReceiptBaseFields
> &
  Partial<Pick<FloatingObjectMutationReceipt, FloatingObjectReceiptBaseFields>>;
type FloatingObjectRemoveReceiptInput = Omit<
  FloatingObjectRemoveReceipt,
  FloatingObjectReceiptBaseFields
> &
  Partial<Pick<FloatingObjectRemoveReceipt, FloatingObjectReceiptBaseFields>>;

function receiptKind(action: 'create' | 'update'): FloatingObjectMutationReceipt['kind'] {
  return action === 'create' ? 'floatingObject.create' : 'floatingObject.update';
}

function objectEffectType(action: 'create' | 'update'): 'createdObject' | 'updatedObject' {
  return action === 'create' ? 'createdObject' : 'updatedObject';
}

function objectTypeFor(object: FloatingObject | undefined): string {
  return object?.type ?? 'floatingObject';
}

function boundsDetails(bounds: ObjectBounds): Record<string, unknown> {
  return {
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      rotation: bounds.rotation,
    },
  };
}

function mutationEffects(input: {
  sheetId: SheetId;
  objectId: string;
  object?: FloatingObject;
  bounds: ObjectBounds;
  action: 'create' | 'update';
}): OperationEffect[] {
  const objectType = objectTypeFor(input.object);
  return [
    {
      type: objectEffectType(input.action),
      sheetId: input.sheetId,
      objectId: input.objectId,
      details: { objectType },
    },
    {
      type: 'changedRange',
      sheetId: input.sheetId,
      objectId: input.objectId,
      details: { objectType, ...boundsDetails(input.bounds) },
    },
    {
      type: 'invalidatedCache',
      sheetId: input.sheetId,
      objectId: input.objectId,
      details: { objectType, cache: 'floatingObjects' },
    },
  ];
}

function removeEffects(sheetId: SheetId, objectId: string): OperationEffect[] {
  return [
    {
      type: 'removedObject',
      sheetId,
      objectId,
      details: { objectType: 'floatingObject' },
    },
    {
      type: 'invalidatedCache',
      sheetId,
      objectId,
      details: { objectType: 'floatingObject', cache: 'floatingObjects' },
    },
  ];
}

async function readBounds(
  ctx: DocumentContext,
  sheetId: SheetId,
  objectId: string,
): Promise<ObjectBounds> {
  try {
    const allBounds = await ctx.computeBridge.computeAllObjectBounds(sheetId);
    for (const [id, bounds] of allBounds) {
      if (id === objectId) return bounds;
    }
  } catch {
    return DEFAULT_BOUNDS;
  }
  return DEFAULT_BOUNDS;
}

export function withFloatingObjectMutationReceiptBase(
  receipt: FloatingObjectMutationReceiptInput,
  sheetId: SheetId,
): FloatingObjectMutationReceipt {
  return {
    ...receipt,
    kind: receipt.kind ?? receiptKind(receipt.action),
    status: receipt.status ?? 'applied',
    effects:
      receipt.effects ??
      mutationEffects({
        sheetId,
        objectId: receipt.id,
        object: receipt.object,
        bounds: receipt.bounds,
        action: receipt.action,
      }),
    diagnostics: receipt.diagnostics ?? [],
    sheetId: receipt.sheetId ?? sheetId,
  };
}

export function withFloatingObjectRemoveReceiptBase(
  receipt: FloatingObjectRemoveReceiptInput,
  sheetId: SheetId,
): FloatingObjectRemoveReceipt {
  return {
    ...receipt,
    kind: receipt.kind ?? 'floatingObject.remove',
    status: receipt.status ?? 'applied',
    effects: receipt.effects ?? removeEffects(sheetId, receipt.id),
    diagnostics: receipt.diagnostics ?? [],
    sheetId: receipt.sheetId ?? sheetId,
  };
}

export function floatingObjectRemoveNoOpReceipt(
  sheetId: SheetId,
  objectId: string,
): FloatingObjectCollectionRemoveReceipt {
  return {
    domain: 'floatingObject',
    action: 'remove',
    id: objectId,
    kind: 'floatingObject.remove',
    status: 'noOp',
    effects: [],
    diagnostics: [],
    sheetId,
    removed: false,
  };
}

export function withFloatingObjectCollectionRemovePayload(
  receipt: FloatingObjectRemoveReceipt,
  removed: boolean,
): FloatingObjectCollectionRemoveReceipt {
  return { ...receipt, removed };
}

export async function buildFloatingObjectMutationReceipt(input: {
  ctx: DocumentContext;
  sheetId: SheetId;
  objectId: string;
  action: 'create' | 'update';
  fallbackType?: FloatingObjectKind;
}): Promise<FloatingObjectMutationReceipt> {
  let wire:
    | Awaited<ReturnType<DocumentContext['computeBridge']['getFloatingObjectTyped']>>
    | undefined;
  try {
    wire = await input.ctx.computeBridge.getFloatingObjectTyped(input.sheetId, input.objectId);
  } catch {
    wire = undefined;
  }
  const object = wire
    ? toFloatingObject(wire)
    : createMinimalFloatingObject(
        input.fallbackType ?? 'shape',
        input.objectId,
        input.sheetId,
      );
  const bounds = wire ? await readBounds(input.ctx, input.sheetId, input.objectId) : DEFAULT_BOUNDS;
  return withFloatingObjectMutationReceiptBase(
    {
      domain: 'floatingObject',
      action: input.action,
      id: input.objectId,
      object,
      bounds,
    },
    input.sheetId,
  );
}

export function attachFloatingObjectHandle<THandle extends object>(
  receipt: FloatingObjectMutationReceipt,
  handle: THandle,
): FloatingObjectHandleMutationReceipt<THandle> {
  const result = Object.create(
    Object.getPrototypeOf(handle),
  ) as FloatingObjectHandleMutationReceipt<THandle>;
  Object.assign(result, handle, receipt, { handle });
  return result;
}
