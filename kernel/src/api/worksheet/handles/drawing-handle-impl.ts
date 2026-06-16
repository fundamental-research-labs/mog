import type {
  FloatingObjectHandleMutationReceipt,
  StrokeTransformParams,
} from '@mog-sdk/contracts/api';
import type { DrawingHandle } from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { DrawingObject, InkStroke, StrokeId } from '@mog-sdk/contracts/ink';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { attachFloatingObjectHandle } from '../objects-receipts';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

export class DrawingHandleImpl extends FloatingObjectHandleImpl implements DrawingHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    super(id, 'drawing', objectsImpl, boundsReader);
  }

  async addStroke(stroke: InkStroke): Promise<void> {
    await this.objectsImpl.addDrawingStroke(this.id, stroke);
  }

  async eraseStrokes(strokeIds: StrokeId[]): Promise<void> {
    await this.objectsImpl.eraseDrawingStrokes(this.id, strokeIds);
  }

  async clearStrokes(): Promise<void> {
    await this.objectsImpl.clearDrawingStrokes(this.id);
  }

  async moveStrokes(strokeIds: StrokeId[], dx: number, dy: number): Promise<void> {
    await this.objectsImpl.moveDrawingStrokes(this.id, strokeIds, dx, dy);
  }

  async transformStrokes(strokeIds: StrokeId[], transform: StrokeTransformParams): Promise<void> {
    await this.objectsImpl.transformDrawingStrokes(this.id, strokeIds, transform);
  }

  async findStrokesAtPoint(x: number, y: number, tolerance?: number): Promise<StrokeId[]> {
    return this.objectsImpl.findStrokesAtPoint(this.id, x, y, tolerance);
  }

  async duplicate(
    _offsetX?: number,
    _offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<DrawingHandle>> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    const handle = new DrawingHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
    return attachFloatingObjectHandle(receipt, handle);
  }

  async getData(): Promise<DrawingObject> {
    const drawing = await this.objectsImpl.getDrawing(this.id);
    if (!drawing) throw new KernelError('OPERATION_FAILED', `Drawing ${this.id} not found`);
    return drawing;
  }
}
