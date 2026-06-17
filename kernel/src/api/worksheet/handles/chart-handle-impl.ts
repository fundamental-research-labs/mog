import type { FloatingObjectHandleMutationReceipt } from '@mog-sdk/contracts/api';
import type { ChartHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { ChartObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

/**
 * Chart handle — hosting ops only.
 * Content ops (series, categories, type, data range) via ws.charts.*
 */
export class ChartHandleImpl extends FloatingObjectHandleImpl implements ChartHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'chart', objectsImpl, boundsReader);
  }

  async duplicate(
    _offsetX?: number,
    _offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<ChartHandle>> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    const handle = new ChartHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getData(): Promise<ChartObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'chart')
      throw new KernelError('OPERATION_FAILED', `Chart ${this.id} not found`);
    return obj;
  }
}
