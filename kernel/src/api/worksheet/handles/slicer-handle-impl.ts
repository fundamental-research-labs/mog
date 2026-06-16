import type { FloatingObjectHandleMutationReceipt } from '@mog-sdk/contracts/api';
import type { SlicerHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

/**
 * Slicer handle — hosting ops only.
 * Content ops (selection, filter state) via ws.slicers.*
 */
export class SlicerHandleImpl extends FloatingObjectHandleImpl implements SlicerHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'slicer', objectsImpl, boundsReader);
  }

  async duplicate(
    _offsetX?: number,
    _offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<SlicerHandle>> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    const handle = new SlicerHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getData(): Promise<FloatingObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj) throw new KernelError('OPERATION_FAILED', `Slicer ${this.id} not found`);
    return obj;
  }
}
