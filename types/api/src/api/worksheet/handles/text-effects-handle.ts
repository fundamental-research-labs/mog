import type { TextBoxObject } from '@mog/types-objects/objects/floating-objects';
import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
} from '../../mutation-receipt';
import type { TextEffectUpdates } from '../../types';
import type { FloatingObjectHandle } from './types';

/** Decorative text-effect objects are text boxes with text-effect configuration. */
export interface TextEffectHandle extends FloatingObjectHandle {
  update(props: TextEffectUpdates): Promise<FloatingObjectMutationReceipt>;
  duplicate(
    offsetX?: number,
    offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<TextEffectHandle>>;
  getData(): Promise<TextBoxObject>;
}
