import type { ShapeConfig } from '../../types';
import type { ShapeHandle } from '../handles/shape-handle';

export interface WorksheetShapeCollection {
  get(id: string): Promise<ShapeHandle | null>;
  list(): Promise<ShapeHandle[]>;
  add(config: ShapeConfig): Promise<ShapeHandle>;
  /** Get a shape by zero-based index. Returns null if index is out of range. */
  getItemAt(index: number): Promise<ShapeHandle | null>;
}
