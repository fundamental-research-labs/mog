import type { ConnectorObject } from '@mog/types-objects/objects/floating-objects';
import type { FloatingObjectHandle } from './types';

export interface ConnectorHandle extends FloatingObjectHandle {
  /** Update connector routing, endpoints, fill, outline. ConnectorConfig pending — uses generic record. */
  update(props: Record<string, unknown>): Promise<void>;
  duplicate(offsetX?: number, offsetY?: number): Promise<ConnectorHandle>;
  getData(): Promise<ConnectorObject>;
}
