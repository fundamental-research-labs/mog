/**
 * Extension Events Module
 *
 * Exports event subscription management and event forwarding functionality.
 *
 * @module extensions/events
 */

export {
  EventSubscriptionManager,
  createEventSubscriptionManager,
  getDefaultEventSubscriptionManager,
  resetDefaultEventSubscriptionManager,
  type EventSubscriptionManagerOptions,
  type SubscriptionResult,
} from './EventSubscriptionManager';

export {
  EventForwarder,
  createEventForwarder,
  type CellChangedEventData,
  type CellsChangedEventData,
  type ChartSelectedEventData,
  type ChartUpdatedEventData,
  type EventForwarderOptions,
  type EventForwarderStats,
  type SelectionChangedEventData,
  type SendEventCallback,
  type SheetActivatedEventData,
  type SheetAddedEventData,
  type SheetDeletedEventData,
  type SheetRenamedEventData,
  type SpreadsheetEventData,
} from './EventForwarder';
