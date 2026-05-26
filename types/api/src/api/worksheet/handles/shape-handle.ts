import type { ShapeObject, ShapeType } from '@mog/types-objects/objects/floating-objects';
import type { ShapeConfig } from '../../types';
import type { FloatingObjectMutationReceipt } from '../../mutation-receipt';
import type { FloatingObjectHandle } from './types';

export interface ShapeHandle extends FloatingObjectHandle {
  readonly shapeType: ShapeType;
  update(props: Partial<ShapeConfig>): Promise<FloatingObjectMutationReceipt>;
  duplicate(offsetX?: number, offsetY?: number): Promise<ShapeHandle>;
  getData(): Promise<ShapeObject>;
}
