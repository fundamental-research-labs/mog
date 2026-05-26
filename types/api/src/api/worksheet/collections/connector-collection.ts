import type { ConnectorHandle } from '../handles/connector-handle';

/** Connector collection — get/list only. add() deferred until ConnectorConfig exists. */
export interface WorksheetConnectorCollection {
  get(id: string): Promise<ConnectorHandle | null>;
  list(): Promise<ConnectorHandle[]>;
}
