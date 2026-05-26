import type { ConnectorHandle, WorksheetConnectorCollection } from '@mog-sdk/contracts/api';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';

import type { WorksheetObjectsImpl } from '../objects';
import { ConnectorHandleImpl } from '../handles/connector-handle-impl';

export class WorksheetConnectorCollectionImpl implements WorksheetConnectorCollection {
  constructor(
    private readonly objectsImpl: WorksheetObjectsImpl,
    private readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  async get(id: string): Promise<ConnectorHandle | null> {
    const info = await this.objectsImpl.get(id);
    if (!info || info.type !== 'connector') return null;
    return new ConnectorHandleImpl(id, this.objectsImpl, this.boundsReader);
  }

  async list(): Promise<ConnectorHandle[]> {
    const infos = await this.objectsImpl.list();
    return infos
      .filter((info) => info.type === 'connector')
      .map((info) => new ConnectorHandleImpl(info.id, this.objectsImpl, this.boundsReader));
  }
}
