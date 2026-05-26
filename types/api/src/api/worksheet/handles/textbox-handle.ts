import type { TextBoxObject } from '@mog/types-objects/objects/floating-objects';
import type { TextBoxConfig } from '../../types';
import type { FloatingObjectHandle } from './types';

export interface TextBoxHandle extends FloatingObjectHandle {
  update(props: Partial<TextBoxConfig>): Promise<void>;
  duplicate(offsetX?: number, offsetY?: number): Promise<TextBoxHandle>;
  getData(): Promise<TextBoxObject>;
}
