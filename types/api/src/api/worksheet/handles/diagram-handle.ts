import type { DiagramObject } from '@mog/types-objects/objects/floating-objects';
import type { FloatingObjectHandle } from './types';

/**
 * Diagram handle — hosting ops only.
 * Content ops (nodes, layout, style) via ws.diagrams.*
 */
export interface DiagramHandle extends FloatingObjectHandle {
  duplicate(offsetX?: number, offsetY?: number): Promise<DiagramHandle>;
  getData(): Promise<DiagramObject>;
}
