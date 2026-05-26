import type {
  PictureConfig,
  PictureHandle,
  WorksheetPictureCollection,
} from '@mog-sdk/contracts/api';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import type { WorksheetObjectsImpl } from '../objects';
import { PictureHandleImpl } from '../handles/picture-handle-impl';

export class WorksheetPictureCollectionImpl implements WorksheetPictureCollection {
  constructor(
    private readonly objectsImpl: WorksheetObjectsImpl,
    private readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  async get(id: string): Promise<PictureHandle | null> {
    const info = await this.objectsImpl.get(id);
    if (!info || info.type !== 'picture') return null;
    return new PictureHandleImpl(id, this.objectsImpl, this.boundsReader);
  }

  async list(): Promise<PictureHandle[]> {
    const infos = await this.objectsImpl.list();
    return infos
      .filter((info) => info.type === 'picture')
      .map((info) => new PictureHandleImpl(info.id, this.objectsImpl, this.boundsReader));
  }

  async add(config: PictureConfig): Promise<PictureHandle> {
    const receipt = await this.objectsImpl.addPicture(config);
    return new PictureHandleImpl(receipt.id, this.objectsImpl, this.boundsReader);
  }
}
