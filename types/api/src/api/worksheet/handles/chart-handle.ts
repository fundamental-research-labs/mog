import type { ChartObject } from '@mog/types-objects/objects/floating-objects';
import type { FloatingObjectHandleMutationReceipt } from '../../mutation-receipt';
import type { FloatingObjectHandle } from './types';

/**
 * Chart handle — hosting ops only.
 * Content ops (series, categories, type, data range) via ws.charts.*
 */
export interface ChartHandle extends FloatingObjectHandle {
  duplicate(
    offsetX?: number,
    offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<ChartHandle>>;
  getData(): Promise<ChartObject>;
}
