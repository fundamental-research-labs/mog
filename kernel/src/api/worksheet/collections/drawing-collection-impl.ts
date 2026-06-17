import type {
  DrawingHandle,
  FloatingObjectHandleMutationReceipt,
  WorksheetDrawingCollection,
} from '@mog-sdk/contracts/api';
import type { CreateDrawingOptions } from '@mog-sdk/contracts/ink';
import type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { DrawingHandleImpl } from '../handles/drawing-handle-impl';

export class WorksheetDrawingCollectionImpl implements WorksheetDrawingCollection {
  constructor(
    private readonly objectsImpl: WorksheetObjectsImpl,
    private readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  async get(id: string): Promise<DrawingHandle | null> {
    const drawing = await this.objectsImpl.getDrawing(id);
    if (!drawing) return null;
    return new DrawingHandleImpl(id, this.objectsImpl, this.boundsReader);
  }

  async list(): Promise<DrawingHandle[]> {
    const infos = await this.objectsImpl.list();
    return infos
      .filter((info) => info.type === 'drawing')
      .map((info) => new DrawingHandleImpl(info.id, this.objectsImpl, this.boundsReader));
  }

  async add(
    position: Partial<ObjectPosition>,
    options?: CreateDrawingOptions,
  ): Promise<FloatingObjectHandleMutationReceipt<DrawingHandle>> {
    const receipt = await this.objectsImpl.createDrawing(position, options);
    const handle = new DrawingHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
    return attachFloatingObjectHandle(receipt, handle);
  }
}
