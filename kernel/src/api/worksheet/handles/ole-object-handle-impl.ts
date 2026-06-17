import type { FloatingObjectHandleMutationReceipt } from '@mog-sdk/contracts/api';
import type { OleObjectHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { OleObjectObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

/**
 * OLE object handle — hosting ops only. Parse-only type, no content mutations.
 */
export class OleObjectHandleImpl extends FloatingObjectHandleImpl implements OleObjectHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'oleObject', objectsImpl, boundsReader);
  }

  async duplicate(
    _offsetX?: number,
    _offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<OleObjectHandle>> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    const handle = new OleObjectHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getData(): Promise<OleObjectObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'oleObject')
      throw new KernelError('OPERATION_FAILED', `OleObject ${this.id} not found`);
    return obj;
  }
}
