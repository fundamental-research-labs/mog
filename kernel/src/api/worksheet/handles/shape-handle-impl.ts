import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
  ShapeConfig,
} from '@mog-sdk/contracts/api';
import type { ShapeHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { ShapeObject, ShapeType } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

/**
 * Convenience proxy for shape text font properties.
 * P19: ShapeFont as first-class sub-object from OfficeJS audit.
 * Each method is sugar over updateShape({ text: { format: { [field]: value } } }).
 */
export class ShapeFontProxy {
  constructor(
    private readonly shapeId: string,
    private readonly objectsImpl: WorksheetObjectsImpl,
  ) {}

  async setBold(value: boolean): Promise<void> {
    await this.objectsImpl.updateShape(this.shapeId, {
      text: { content: '', format: { bold: value } } as any,
    });
  }

  async setItalic(value: boolean): Promise<void> {
    await this.objectsImpl.updateShape(this.shapeId, {
      text: { content: '', format: { italic: value } } as any,
    });
  }

  async setColor(value: string): Promise<void> {
    await this.objectsImpl.updateShape(this.shapeId, {
      text: { content: '', format: { fontColor: value } } as any,
    });
  }

  async setName(value: string): Promise<void> {
    await this.objectsImpl.updateShape(this.shapeId, {
      text: { content: '', format: { fontFamily: value } } as any,
    });
  }

  async setSize(value: number): Promise<void> {
    await this.objectsImpl.updateShape(this.shapeId, {
      text: { content: '', format: { fontSize: value } } as any,
    });
  }

  async setUnderline(value: string): Promise<void> {
    await this.objectsImpl.updateShape(this.shapeId, {
      text: { content: '', format: { underlineType: value } } as any,
    });
  }
}

export class ShapeHandleImpl extends FloatingObjectHandleImpl implements ShapeHandle {
  readonly shapeType: ShapeType;

  constructor(
    id: string,
    shapeType: ShapeType,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'shape', objectsImpl, boundsReader);
    this.shapeType = shapeType;
  }

  get font(): ShapeFontProxy {
    return new ShapeFontProxy(this.id, this.objectsImpl);
  }

  async update(props: Partial<ShapeConfig>): Promise<FloatingObjectMutationReceipt> {
    return this.objectsImpl.updateShape(this.id, props);
  }

  async duplicate(
    _offsetX?: number,
    _offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<ShapeHandle>> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    const handle = new ShapeHandleImpl(
      receipt.id,
      this.shapeType,
      this.objectsImpl,
      this.boundsReader,
    );
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getData(): Promise<ShapeObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'shape')
      throw new KernelError('OPERATION_FAILED', `Shape ${this.id} not found`);
    return obj;
  }
}
