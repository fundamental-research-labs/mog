import type { DocumentContext } from '../../../context/types';
import type {
  ChartFloatingObjectEventContext,
  ChartFloatingObjectEventRenderCache,
} from './chart-floating-object-events';

export interface ChartBridgeSubscriptionRenderCache extends ChartFloatingObjectEventRenderCache {}

export interface ChartBridgeSubscriptionContext extends ChartFloatingObjectEventContext {
  ctx: DocumentContext;
  renderCache: ChartBridgeSubscriptionRenderCache;
  isLive(): boolean;
  clearAllCaches(): void;
}
