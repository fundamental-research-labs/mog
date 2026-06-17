import type { OleObjectObject } from '@mog/types-objects/objects/floating-objects';
import type { FloatingObjectHandleMutationReceipt } from '../../mutation-receipt';
import type { FloatingObjectHandle } from './types';

/**
 * OLE object handle — hosting ops only. Parse-only type, no content mutations.
 */
export interface OleObjectHandle extends FloatingObjectHandle {
  duplicate(
    offsetX?: number,
    offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<OleObjectHandle>>;
  getData(): Promise<OleObjectObject>;
}
