import type { ConnectorHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { ConnectorObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

export class ConnectorHandleImpl extends FloatingObjectHandleImpl implements ConnectorHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'connector', objectsImpl, boundsReader);
  }

  async update(props: Record<string, unknown>): Promise<void> {
    await this.objectsImpl.update(this.id, props);
  }

  async duplicate(_offsetX?: number, _offsetY?: number): Promise<ConnectorHandle> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    return new ConnectorHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
  }

  async getData(): Promise<ConnectorObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'connector')
      throw new KernelError('OPERATION_FAILED', `Connector ${this.id} not found`);
    return obj;
  }
}
