import type {
  TextBoxConfig,
  TextBoxHandle,
  WorksheetTextBoxCollection,
} from '@mog-sdk/contracts/api';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import type { WorksheetObjectsImpl } from '../objects';
import { TextBoxHandleImpl } from '../handles/textbox-handle-impl';

/**
 * NOTE: Both TextBox and TextEffect objects are stored with type 'textbox' in FloatingObjectInfo.
 * There is no discriminant field to distinguish them, so list() and get() may include
 * TextEffect objects. Callers needing only pure textboxes (excluding TextEffect) should use
 * additional filtering once a discriminant is available.
 */
export class WorksheetTextBoxCollectionImpl implements WorksheetTextBoxCollection {
  constructor(
    private readonly objectsImpl: WorksheetObjectsImpl,
    private readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  async get(id: string): Promise<TextBoxHandle | null> {
    const info = await this.objectsImpl.get(id);
    if (!info || info.type !== 'textbox') return null;
    return new TextBoxHandleImpl(id, this.objectsImpl, this.boundsReader);
  }

  async list(): Promise<TextBoxHandle[]> {
    const infos = await this.objectsImpl.list();
    return infos
      .filter((info) => info.type === 'textbox')
      .map((info) => new TextBoxHandleImpl(info.id, this.objectsImpl, this.boundsReader));
  }

  async add(config: TextBoxConfig): Promise<TextBoxHandle> {
    const receipt = await this.objectsImpl.addTextBox(config);
    return new TextBoxHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
  }
}
