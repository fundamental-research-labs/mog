import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
  PictureConfig,
} from '@mog-sdk/contracts/api';
import type { PictureHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { PictureObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

export class PictureHandleImpl extends FloatingObjectHandleImpl implements PictureHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'picture', objectsImpl, boundsReader);
  }

  async update(props: Partial<PictureConfig>): Promise<FloatingObjectMutationReceipt> {
    return this.objectsImpl.updatePicture(this.id, props);
  }

  async duplicate(
    _offsetX?: number,
    _offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<PictureHandle>> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    const handle = new PictureHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getData(): Promise<PictureObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'picture')
      throw new KernelError('OPERATION_FAILED', `Picture ${this.id} not found`);
    return obj;
  }
}
