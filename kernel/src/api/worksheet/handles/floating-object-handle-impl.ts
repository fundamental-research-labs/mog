/**
 * FloatingObjectHandleImpl -- Base handle implementation.
 *
 * Stateless facade that delegates hosting ops to WorksheetObjectsImpl.
 * boundsReader is optional (null in headless/server context).
 *
 * Type narrowing: The factory function (createFloatingObjectHandle) constructs
 * the correct subclass, so is*() and as*() are always accurate.
 */
import type { FloatingObject, FloatingObjectKind } from '@mog-sdk/contracts/floating-objects';
import type {
  IObjectBoundsReader,
  ObjectBounds,
} from '@mog-sdk/contracts/objects/object-bounds-reader';
import type {
  FloatingObjectRemoveReceipt,
  FloatingObjectMutationReceipt,
} from '@mog-sdk/contracts/api';
import type {
  FloatingObjectHandle,
  ShapeHandle,
  PictureHandle,
  TextBoxHandle,
  DrawingHandle,
  EquationHandle,
  TextEffectHandle,
  DiagramHandle,
  ChartHandle,
  ConnectorHandle,
  OleObjectHandle,
  SlicerHandle,
} from '@mog-sdk/contracts/api/worksheet/handles/index';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';

/**
 * Runtime-checked type narrowing. The factory guarantees that when
 * type matches, `handle` is the correct subclass. This helper encapsulates
 * the single narrow point where we assert the factory's invariant.
 */
function narrowHandle<T>(handle: FloatingObjectHandleImpl, expected: string): T {
  if (handle.type !== expected) {
    throw new KernelError('OPERATION_FAILED', `Expected ${expected}, got ${handle.type}`);
  }
  // Safe: the factory constructs the correct subclass for each type discriminant.
  // At runtime, `handle` IS a ShapeHandleImpl/PictureHandleImpl/etc.
  return handle as T;
}

export class FloatingObjectHandleImpl implements FloatingObjectHandle {
  constructor(
    readonly id: string,
    readonly type: FloatingObjectKind,
    protected readonly objectsImpl: WorksheetObjectsImpl,
    protected readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  // -- Spatial --
  async move(dx: number, dy: number): Promise<FloatingObjectMutationReceipt> {
    return this.objectsImpl.move(this.id, dx, dy);
  }

  async resize(width: number, height: number): Promise<FloatingObjectMutationReceipt> {
    return this.objectsImpl.resize(this.id, width, height);
  }

  async rotate(angle: number): Promise<void> {
    await this.objectsImpl.rotate(this.id, angle);
  }

  async flip(axis: 'horizontal' | 'vertical'): Promise<void> {
    await this.objectsImpl.flip(this.id, axis);
  }

  // -- Z-order --
  async bringToFront(): Promise<void> {
    await this.objectsImpl.bringToFront(this.id);
  }
  async sendToBack(): Promise<void> {
    await this.objectsImpl.sendToBack(this.id);
  }
  async bringForward(): Promise<void> {
    await this.objectsImpl.bringForward(this.id);
  }
  async sendBackward(): Promise<void> {
    await this.objectsImpl.sendBackward(this.id);
  }

  // -- Lifecycle --
  async delete(): Promise<FloatingObjectRemoveReceipt> {
    return this.objectsImpl.remove(this.id);
  }

  async duplicate(_offsetX?: number, _offsetY?: number): Promise<FloatingObjectHandle> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    return new FloatingObjectHandleImpl(receipt.id, this.type, this.objectsImpl, this.boundsReader);
  }

  // -- Reads --
  getBounds(): ObjectBounds | null {
    return this.boundsReader?.getBounds(this.id) ?? null;
  }

  async getData(): Promise<FloatingObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj) throw new KernelError('OPERATION_FAILED', `Object ${this.id} not found`);
    return obj;
  }

  // -- Type narrowing (is* predicates) --
  isShape(): this is ShapeHandle {
    return this.type === 'shape';
  }
  isPicture(): this is PictureHandle {
    return this.type === 'picture';
  }
  isTextBox(): this is TextBoxHandle {
    return this.type === 'textbox';
  }
  isDrawing(): this is DrawingHandle {
    return this.type === 'drawing';
  }
  isEquation(): this is EquationHandle {
    return this.type === 'equation';
  }
  isTextEffect(): this is TextEffectHandle {
    return false;
  }
  isDiagram(): this is DiagramHandle {
    return this.type === 'diagram';
  }
  isChart(): this is ChartHandle {
    return this.type === 'chart';
  }
  isCamera(): boolean {
    return false;
  }
  isConnector(): this is ConnectorHandle {
    return this.type === 'connector';
  }
  isOleObject(): this is OleObjectHandle {
    return this.type === 'oleObject';
  }
  isSlicer(): this is SlicerHandle {
    return this.type === 'slicer';
  }

  /**
   * Type-checked narrowing — throws if this handle's type does not match.
   * The factory (createFloatingObjectHandle) guarantees that when type === 'shape',
   * `this` is a ShapeHandleImpl which implements ShapeHandle, etc.
   */
  asShape(): ShapeHandle {
    return narrowHandle<ShapeHandle>(this, 'shape');
  }
  asPicture(): PictureHandle {
    return narrowHandle<PictureHandle>(this, 'picture');
  }
  asTextBox(): TextBoxHandle {
    return narrowHandle<TextBoxHandle>(this, 'textbox');
  }
  asDrawing(): DrawingHandle {
    return narrowHandle<DrawingHandle>(this, 'drawing');
  }
  asEquation(): EquationHandle {
    return narrowHandle<EquationHandle>(this, 'equation');
  }
  asTextEffect(): TextEffectHandle {
    // TextEffect is stored as type 'textbox' — base class always throws.
    // TextEffectHandleImpl overrides this to return itself.
    throw new KernelError('OPERATION_FAILED', `Expected text-effects, got ${this.type}`);
  }
  asDiagram(): DiagramHandle {
    return narrowHandle<DiagramHandle>(this, 'diagram');
  }
  asChart(): ChartHandle {
    return narrowHandle<ChartHandle>(this, 'chart');
  }
  asConnector(): ConnectorHandle {
    return narrowHandle<ConnectorHandle>(this, 'connector');
  }
  asOleObject(): OleObjectHandle {
    return narrowHandle<OleObjectHandle>(this, 'oleObject');
  }
  asSlicer(): SlicerHandle {
    return narrowHandle<SlicerHandle>(this, 'slicer');
  }
}
