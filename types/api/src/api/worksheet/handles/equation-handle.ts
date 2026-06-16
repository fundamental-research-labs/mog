import type { EquationObject } from '@mog/types-objects/objects/floating-objects';
import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
} from '../../mutation-receipt';
import type { EquationUpdates } from '../../types';
import type { FloatingObjectHandle } from './types';

export interface EquationHandle extends FloatingObjectHandle {
  update(props: EquationUpdates): Promise<FloatingObjectMutationReceipt>;
  duplicate(
    offsetX?: number,
    offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<EquationHandle>>;
  getData(): Promise<EquationObject>;
}
