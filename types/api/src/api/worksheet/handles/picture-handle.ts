import type { PictureObject } from '@mog/types-objects/objects/floating-objects';
import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
} from '../../mutation-receipt';
import type { PictureConfig } from '../../types';
import type { FloatingObjectHandle } from './types';

export interface PictureHandle extends FloatingObjectHandle {
  update(props: Partial<PictureConfig>): Promise<FloatingObjectMutationReceipt>;
  duplicate(
    offsetX?: number,
    offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<PictureHandle>>;
  getData(): Promise<PictureObject>;
}
