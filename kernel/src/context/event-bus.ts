/**
 * Event Bus Implementation
 *
 * A pub-sub system that translates CRDT operations into semantic events.
 * This is THE event bus implementation for the spreadsheet system.
 * Shell and bridges import from kernel.
 *
 * @see contracts/src/events.ts - Event type definitions
 */

import type {
  AllEventsHandler,
  EventHandler,
  IEventBus,
  SpreadsheetEvent,
  SpreadsheetEventType,
} from '@mog-sdk/contracts/events';

/**
 * Generate a unique transaction ID
 */
function generateTransactionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Map of event types to their handlers
 */
type HandlerMap = Map<SpreadsheetEventType, Set<EventHandler<SpreadsheetEvent>>>;

/**
 * Creates a new event bus instance.
 */
export function createEventBus(): IEventBus {
  const handlers: HandlerMap = new Map();
  const allHandlers: Set<AllEventsHandler> = new Set();

  function getHandlerSet(type: SpreadsheetEventType): Set<EventHandler<SpreadsheetEvent>> {
    let set = handlers.get(type);
    if (!set) {
      set = new Set();
      handlers.set(type, set);
    }
    return set;
  }

  return {
    on<T extends SpreadsheetEvent>(type: T['type'], handler: EventHandler<T>): () => void {
      const set = getHandlerSet(type as SpreadsheetEventType);
      set.add(handler as EventHandler<SpreadsheetEvent>);

      return () => {
        set.delete(handler as EventHandler<SpreadsheetEvent>);
      };
    },

    onMany(types: SpreadsheetEventType[], handler: EventHandler<SpreadsheetEvent>): () => void {
      const unsubscribers = types.map((type) => this.on(type, handler));

      return () => {
        unsubscribers.forEach((unsub) => unsub());
      };
    },

    onAll(handler: AllEventsHandler): () => void {
      allHandlers.add(handler);

      return () => {
        allHandlers.delete(handler);
      };
    },

    emit(event: SpreadsheetEvent): void {
      const typeHandlers = handlers.get(event.type as SpreadsheetEventType);
      if (typeHandlers) {
        typeHandlers.forEach((handler) => {
          try {
            handler(event);
          } catch (error) {
            console.error(`[EventBus] Handler error for "${event.type}":`, error);
          }
        });
      }

      allHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error(`[EventBus] All-handler error for "${event.type}":`, error);
        }
      });

      if (typeof window !== 'undefined') window.__OS_DEVTOOLS__?.reportEvent?.(event);
    },

    emitBatch(events: SpreadsheetEvent[]): void {
      if (events.length === 0) return;

      const transactionId = generateTransactionId();

      events.forEach((event) => {
        this.emit({
          ...event,
          transactionId,
        });
      });
    },

    clear(): void {
      handlers.clear();
      allHandlers.clear();
    },
  };
}
