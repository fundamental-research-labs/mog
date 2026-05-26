import type { TextBoxObject } from '@mog/types-objects/objects/floating-objects';
import type { TextEffectUpdates } from '../../types';
import type { FloatingObjectHandle } from './types';

/** Decorative text-effect objects are text boxes with text-effect configuration. */
export interface TextEffectHandle extends FloatingObjectHandle {
  update(props: TextEffectUpdates): Promise<void>;
  duplicate(offsetX?: number, offsetY?: number): Promise<TextEffectHandle>;
  getData(): Promise<TextBoxObject>;
}
