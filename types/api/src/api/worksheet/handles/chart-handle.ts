import type { ChartObject } from '@mog/types-objects/objects/floating-objects';
import type { FloatingObjectHandle } from './types';

/**
 * Chart handle — hosting ops only.
 * Content ops (series, categories, type, data range) via ws.charts.*
 */
export interface ChartHandle extends FloatingObjectHandle {
  duplicate(offsetX?: number, offsetY?: number): Promise<ChartHandle>;
  getData(): Promise<ChartObject>;
}
