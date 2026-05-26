import type { TextEffectUpdates } from '@mog-sdk/contracts/api';
import type {
  TextEffectHandle,
  TextBoxHandle,
} from '@mog-sdk/contracts/api/worksheet/handles/index';
import type { TextBoxObject } from '@mog-sdk/contracts/floating-objects';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import { KernelError } from '../../../errors';
import type { WorksheetObjectsImpl } from '../objects';
import { FloatingObjectHandleImpl } from './floating-object-handle-impl';

/**
 * TextEffect objects are textboxes with TextEffect configuration.
 * Stored as type 'textbox' with textEffects flag — isTextEffect() returns true.
 */
export class TextEffectHandleImpl extends FloatingObjectHandleImpl implements TextEffectHandle {
  constructor(
    id: string,
    objectsImpl: WorksheetObjectsImpl,
    boundsReader: IObjectBoundsReader | null,
  ) {
    // TextEffect is stored as 'textbox' type
    super(id, 'textbox', objectsImpl, boundsReader);
  }

  override isTextEffect(): this is TextEffectHandle {
    return true;
  }

  /** TextEffect handles support asTextEffect() — base class throws because type is 'textbox', not 'text-effects'. */
  override asTextEffect(): TextEffectHandle {
    return this;
  }

  /** TextEffect is a distinct abstraction from TextBox; disallow narrowing to TextBoxHandle. */
  override asTextBox(): TextBoxHandle {
    throw new KernelError(
      'OPERATION_FAILED',
      'Cannot narrow TextEffect to TextBox — use asTextEffect() instead',
    );
  }

  async update(props: TextEffectUpdates): Promise<void> {
    await this.objectsImpl.updateTextEffect(this.id, props);
  }

  async duplicate(_offsetX?: number, _offsetY?: number): Promise<TextEffectHandle> {
    const receipt = await this.objectsImpl.duplicate(this.id);
    return new TextEffectHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
  }

  async getData(): Promise<TextBoxObject> {
    const obj = await this.objectsImpl.getFullObject(this.id);
    if (!obj || obj.type !== 'textbox')
      throw new KernelError('OPERATION_FAILED', `TextEffect ${this.id} not found`);
    return obj;
  }
}
