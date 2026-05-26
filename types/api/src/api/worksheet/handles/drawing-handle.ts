import type { DrawingObject, InkStroke, StrokeId } from '@mog/types-objects/ink/types';
import type { StrokeTransformParams } from '../../types';
import type { FloatingObjectHandle } from './types';

export interface DrawingHandle extends FloatingObjectHandle {
  addStroke(stroke: InkStroke): Promise<void>;
  eraseStrokes(strokeIds: StrokeId[]): Promise<void>;
  clearStrokes(): Promise<void>;
  moveStrokes(strokeIds: StrokeId[], dx: number, dy: number): Promise<void>;
  transformStrokes(strokeIds: StrokeId[], transform: StrokeTransformParams): Promise<void>;
  findStrokesAtPoint(x: number, y: number, tolerance?: number): Promise<StrokeId[]>;
  duplicate(offsetX?: number, offsetY?: number): Promise<DrawingHandle>;
  getData(): Promise<DrawingObject>;
}
