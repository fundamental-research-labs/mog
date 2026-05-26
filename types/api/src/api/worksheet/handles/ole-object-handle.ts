import type { OleObjectObject } from '@mog/types-objects/objects/floating-objects';
import type { FloatingObjectHandle } from './types';

/**
 * OLE object handle — hosting ops only. Parse-only type, no content mutations.
 */
export interface OleObjectHandle extends FloatingObjectHandle {
  duplicate(offsetX?: number, offsetY?: number): Promise<OleObjectHandle>;
  getData(): Promise<OleObjectObject>;
}
