import type { ConnectorObject } from '@mog/types-objects/objects/floating-objects';
import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectMutationReceipt,
} from '../../mutation-receipt';
import type { FloatingObjectHandle } from './types';

export interface ConnectorHandle extends FloatingObjectHandle {
  /** Update connector routing, endpoints, fill, outline. ConnectorConfig pending — uses generic record. */
  update(props: Record<string, unknown>): Promise<FloatingObjectMutationReceipt>;
  duplicate(
    offsetX?: number,
    offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<ConnectorHandle>>;
  getData(): Promise<ConnectorObject>;
}
