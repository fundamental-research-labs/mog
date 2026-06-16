import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
  TextBoxConfig,
} from '@mog-sdk/contracts/api';
import type { TextBoxHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { TextBoxObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

export class TextBoxHandleImpl extends FloatingObjectHandleImpl implements TextBoxHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'textbox', objectsImpl, boundsReader);
  }

  async update(props: Partial<TextBoxConfig>): Promise<FloatingObjectMutationReceipt> {
    return this.objectsImpl.update(this.id, props as Record<string, unknown>);
  }

  async duplicate(
    _offsetX?: number,
    _offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<TextBoxHandle>> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    const handle = new TextBoxHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getData(): Promise<TextBoxObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'textbox')
      throw new KernelError('OPERATION_FAILED', `TextBox ${this.id} not found`);
    return obj;
  }
}
