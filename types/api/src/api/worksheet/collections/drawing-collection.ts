import type { CreateDrawingOptions } from '@mog/types-objects/ink/types';
import type { ObjectPosition } from '@mog/types-objects/objects/floating-objects';
import type { DrawingHandle } from '../handles/drawing-handle';

export interface WorksheetDrawingCollection {
  get(id: string): Promise<DrawingHandle | null>;
  list(): Promise<DrawingHandle[]>;
  add(position: Partial<ObjectPosition>, options?: CreateDrawingOptions): Promise<DrawingHandle>;
}
