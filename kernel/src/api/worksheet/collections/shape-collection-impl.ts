import type {
  FloatingObjectHandleMutationReceipt,
  ShapeConfig,
  ShapeHandle,
  WorksheetShapeCollection,
} from '@mog-sdk/contracts/api';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { ShapeHandleImpl } from '../handles/shape-handle-impl';

export class WorksheetShapeCollectionImpl implements WorksheetShapeCollection {
  constructor(
    private readonly objectsImpl: WorksheetObjectsImpl,
    private readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  async get(id: string): Promise<ShapeHandle | null> {
    const shape = await this.objectsImpl.getShape(id);
    if (!shape) return null;
    return new ShapeHandleImpl(id, shape.type, this.objectsImpl, this.boundsReader);
  }

  async list(): Promise<ShapeHandle[]> {
    const shapes = await this.objectsImpl.listShapes();
    return shapes.map(
      (s) => new ShapeHandleImpl(s.id, s.type, this.objectsImpl, this.boundsReader),
    );
  }

  async add(config: ShapeConfig): Promise<FloatingObjectHandleMutationReceipt<ShapeHandle>> {
    const receipt = await this.objectsImpl.addShape(config);
    const handle = new ShapeHandleImpl(
      receipt.id,
      config.type,
      this.objectsImpl,
      this.boundsReader,
    );
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getItemAt(index: number): Promise<ShapeHandle | null> {
    const items = await this.list();
    return items[index] ?? null;
  }
}
