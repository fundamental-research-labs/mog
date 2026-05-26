import type { EquationUpdates } from '@mog-sdk/contracts/api';
import type { EquationHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { EquationObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

export class EquationHandleImpl extends FloatingObjectHandleImpl implements EquationHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'equation', objectsImpl, boundsReader);
  }

  async update(props: EquationUpdates): Promise<void> {
    await this.objectsImpl.updateEquation(this.id, props);
  }

  async duplicate(_offsetX?: number, _offsetY?: number): Promise<EquationHandle> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    return new EquationHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
  }

  async getData(): Promise<EquationObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'equation')
      throw new KernelError('OPERATION_FAILED', `Equation ${this.id} not found`);
    return obj;
  }
}
