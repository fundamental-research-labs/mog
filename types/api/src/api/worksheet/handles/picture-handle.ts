import type { PictureObject } from '@mog/types-objects/objects/floating-objects';
import type { PictureConfig } from '../../types';
import type { FloatingObjectHandle } from './types';

export interface PictureHandle extends FloatingObjectHandle {
  update(props: Partial<PictureConfig>): Promise<void>;
  duplicate(offsetX?: number, offsetY?: number): Promise<PictureHandle>;
  getData(): Promise<PictureObject>;
}
