import type { TextBoxObject } from '@mog/types-objects/objects/floating-objects';
import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
} from '../../mutation-receipt';
import type { TextBoxConfig } from '../../types';
import type { FloatingObjectHandle } from './types';

export interface TextBoxHandle extends FloatingObjectHandle {
  update(props: Partial<TextBoxConfig>): Promise<FloatingObjectMutationReceipt>;
  duplicate(
    offsetX?: number,
    offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<TextBoxHandle>>;
  getData(): Promise<TextBoxObject>;
}
