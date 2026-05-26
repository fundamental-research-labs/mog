import type { EquationObject } from '@mog/types-objects/objects/floating-objects';
import type { EquationUpdates } from '../../types';
import type { FloatingObjectHandle } from './types';

export interface EquationHandle extends FloatingObjectHandle {
  update(props: EquationUpdates): Promise<void>;
  duplicate(offsetX?: number, offsetY?: number): Promise<EquationHandle>;
  getData(): Promise<EquationObject>;
}
