import type { DiagramHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { DiagramObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

/**
 * Diagram handle — hosting ops only.
 * Content ops (nodes, layout, style) via ws.diagrams.*
 */
export class DiagramHandleImpl extends FloatingObjectHandleImpl implements DiagramHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'diagram', objectsImpl, boundsReader);
  }

  async duplicate(_offsetX?: number, _offsetY?: number): Promise<DiagramHandle> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    return new DiagramHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
  }

  async getData(): Promise<DiagramObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'diagram')
      throw new KernelError('OPERATION_FAILED', `Diagram ${this.id} not found`);
    return obj;
  }
}
