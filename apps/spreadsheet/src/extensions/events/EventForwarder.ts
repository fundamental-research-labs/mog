/**
 * Event Forwarder
 *
 * Forwards spreadsheet events to subscribed extensions with permission
 * filtering and debouncing for high-frequency events.
 *
 * Features:
 * - Subscribes to spreadsheet events via event bus
 * - Filters events by extension permissions
 * - Debounces high-frequency events (selection during drag)
 * - Rate limits event forwarding per extension
 * - Only forwards to extensions that subscribed
 *
 * @module extensions/events/EventForwarder
 */

import { EVENT_DEBOUNCE_DELAYS, EVENTS_PER_SECOND, type ForwardableEvent } from '../constants';
import type { MessageBridge } from '../messaging/MessageBridge';
import { EventSubscriptionManager } from './EventSubscriptionManager';

// =============================================================================
// Types
// =============================================================================

/**
 * Event data for different event types
 */
export interface SelectionChangedEventData {
  sheetId: string;
  sheetName: string;
  range: string;
  previousRange?: string;
}

export interface CellChangedEventData {
  sheetId: string;
  sheetName: string;
  cell: string;
  oldValue?: unknown;
  newValue: unknown;
  oldFormula?: string;
  newFormula?: string;
}

export interface CellsChangedEventData {
  sheetId: string;
  sheetName: string;
  range: string;
  changes: Array<{
    cell: string;
    oldValue?: unknown;
    newValue: unknown;
  }>;
}

export interface SheetActivatedEventData {
  sheetId: string;
  sheetName: string;
  previousSheetId?: string;
  previousSheetName?: string;
}

export interface SheetAddedEventData {
  sheetId: string;
  sheetName: string;
  index: number;
}

export interface SheetDeletedEventData {
  sheetId: string;
  sheetName: string;
}

export interface SheetRenamedEventData {
  sheetId: string;
  oldName: string;
  newName: string;
}

export interface ChartSelectedEventData {
  chartId: string;
  sheetId: string;
}

export interface ChartUpdatedEventData {
  chartId: string;
  sheetId: string;
  changes: string[];
}

/**
 * Union of all event data types
 */
export type SpreadsheetEventData =
  | SelectionChangedEventData
  | CellChangedEventData
  | CellsChangedEventData
  | SheetActivatedEventData
  | SheetAddedEventData
  | SheetDeletedEventData
  | SheetRenamedEventData
  | ChartSelectedEventData
  | ChartUpdatedEventData;

/**
 * Callback type for sending events to extensions
 */
export type SendEventCallback = (extensionId: string, event: string, data: unknown) => void;

/**
 * Rate limiter state per extension
 */
interface ExtensionRateLimiter {
  timestamps: number[];
  count: number;
}

/**
 * Options for creating an EventForwarder
 */
export interface EventForwarderOptions {
  /**
   * Subscription manager to use
   */
  subscriptionManager: EventSubscriptionManager;

  /**
   * Map of extension ID to MessageBridge
   */
  bridges?: Map<string, MessageBridge>;

  /**
   * Alternative: callback for sending events
   */
  sendEvent?: SendEventCallback;

  /**
   * Maximum events per second per extension
   */
  maxEventsPerSecond?: number;

  /**
   * Callback when an event is forwarded
   */
  onForward?: (extensionId: string, event: string, data: unknown) => void;

  /**
   * Callback when an event is rate limited
   */
  onRateLimited?: (extensionId: string, event: string) => void;

  /**
   * Callback for errors
   */
  onError?: (error: Error, context?: string) => void;
}

/**
 * Statistics about event forwarding
 */
export interface EventForwarderStats {
  /** Total events received */
  eventsReceived: number;
  /** Events forwarded to extensions */
  eventsForwarded: number;
  /** Events dropped due to no subscribers */
  eventsNoSubscribers: number;
  /** Events dropped due to rate limiting */
  eventsRateLimited: number;
  /** Per-event type counts */
  eventsByType: Record<string, number>;
}

// =============================================================================
// EventForwarder Class
// =============================================================================

/**
 * Forwards spreadsheet events to subscribed extensions.
 *
 * Usage:
 * ```typescript
 * const forwarder = new EventForwarder({
 * subscriptionManager,
 * bridges: extensionBridges,
 * });
 *
 * // Forward an event from the spreadsheet
 * forwarder.forward('selectionChanged', {
 * sheetId: 'sheet1',
 * sheetName: 'Sheet 1',
 * range: 'A1:B2'
 * });
 *
 * // Clean up
 * forwarder.destroy();
 * ```
 */
export class EventForwarder {
  private subscriptionManager: EventSubscriptionManager;
  private bridges: Map<string, MessageBridge>;
  private sendEventCallback?: SendEventCallback;

  private maxEventsPerSecond: number;
  private rateLimiters: Map<string, ExtensionRateLimiter> = new Map();

  private debouncers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  private onForward?: (extensionId: string, event: string, data: unknown) => void;
  private onRateLimited?: (extensionId: string, event: string) => void;
  private onError?: (error: Error, context?: string) => void;

  private isDestroyed = false;

  // Statistics
  private stats: EventForwarderStats = {
    eventsReceived: 0,
    eventsForwarded: 0,
    eventsNoSubscribers: 0,
    eventsRateLimited: 0,
    eventsByType: {},
  };

  constructor(options: EventForwarderOptions) {
    this.subscriptionManager = options.subscriptionManager;
    this.bridges = options.bridges ?? new Map();
    this.sendEventCallback = options.sendEvent;
    this.maxEventsPerSecond = options.maxEventsPerSecond ?? EVENTS_PER_SECOND;

    this.onForward = options.onForward;
    this.onRateLimited = options.onRateLimited;
    this.onError = options.onError;
  }

  // ---------------------------------------------------------------------------
  // Event Forwarding
  // ---------------------------------------------------------------------------

  /**
   * Forward an event to all subscribed extensions.
   *
   * @param event - The event name
   * @param data - The event data
   */
  forward(event: ForwardableEvent, data: SpreadsheetEventData): void {
    if (this.isDestroyed) {
      return;
    }

    this.stats.eventsReceived++;
    this.stats.eventsByType[event] = (this.stats.eventsByType[event] ?? 0) + 1;

    // Check if event should be debounced
    const debounceDelay = EVENT_DEBOUNCE_DELAYS[event];
    if (debounceDelay && debounceDelay > 0) {
      this.debouncedForward(event, data, debounceDelay);
    } else {
      this.immediateForward(event, data);
    }
  }

  /**
   * Forward an event with debouncing.
   */
  private debouncedForward(
    event: ForwardableEvent,
    data: SpreadsheetEventData,
    delay: number,
  ): void {
    // Cancel any pending debounced call for this event
    const existingTimer = this.debouncers.get(event);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new forward
    const timer = setTimeout(() => {
      this.debouncers.delete(event);
      this.immediateForward(event, data);
    }, delay);

    this.debouncers.set(event, timer);
  }

  /**
   * Forward an event immediately to all subscribers.
   */
  private immediateForward(event: ForwardableEvent, data: SpreadsheetEventData): void {
    // Get all subscribers
    const subscribers = this.subscriptionManager.getSubscribers(event);

    if (subscribers.length === 0) {
      this.stats.eventsNoSubscribers++;
      return;
    }

    // Forward to each subscriber
    for (const extensionId of subscribers) {
      this.forwardToExtension(extensionId, event, data);
    }
  }

  /**
   * Forward an event to a specific extension.
   */
  private forwardToExtension(extensionId: string, event: string, data: unknown): void {
    // Check rate limit
    if (this.isRateLimited(extensionId)) {
      this.stats.eventsRateLimited++;
      this.onRateLimited?.(extensionId, event);
      return;
    }

    // Record for rate limiting
    this.recordEvent(extensionId);

    try {
      // Use callback if provided
      if (this.sendEventCallback) {
        this.sendEventCallback(extensionId, event, data);
        this.stats.eventsForwarded++;
        this.onForward?.(extensionId, event, data);
        return;
      }

      // Use bridge if available
      const bridge = this.bridges.get(extensionId);
      if (bridge) {
        bridge.sendEvent(event, data);
        this.stats.eventsForwarded++;
        this.onForward?.(extensionId, event, data);
        return;
      }

      // No way to send - this shouldn't happen
      this.onError?.(
        new Error(`No bridge or callback for extension: ${extensionId}`),
        'forward_to_extension',
      );
    } catch (error) {
      this.onError?.(
        error instanceof Error ? error : new Error(String(error)),
        `forward_event_${event}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Rate Limiting
  // ---------------------------------------------------------------------------

  /**
   * Check if an extension is rate limited.
   */
  private isRateLimited(extensionId: string): boolean {
    this.cleanupRateLimiter(extensionId);
    const limiter = this.rateLimiters.get(extensionId);
    return limiter ? limiter.count >= this.maxEventsPerSecond : false;
  }

  /**
   * Record an event for rate limiting.
   */
  private recordEvent(extensionId: string): void {
    let limiter = this.rateLimiters.get(extensionId);
    if (!limiter) {
      limiter = { timestamps: [], count: 0 };
      this.rateLimiters.set(extensionId, limiter);
    }

    limiter.timestamps.push(Date.now());
    limiter.count++;
  }

  /**
   * Clean up old timestamps from rate limiter.
   */
  private cleanupRateLimiter(extensionId: string): void {
    const limiter = this.rateLimiters.get(extensionId);
    if (!limiter) {
      return;
    }

    const now = Date.now();
    const windowStart = now - 1000; // 1 second window

    limiter.timestamps = limiter.timestamps.filter((ts) => ts > windowStart);
    limiter.count = limiter.timestamps.length;
  }

  // ---------------------------------------------------------------------------
  // Bridge Management
  // ---------------------------------------------------------------------------

  /**
   * Register a bridge for an extension.
   */
  registerBridge(extensionId: string, bridge: MessageBridge): void {
    this.bridges.set(extensionId, bridge);
  }

  /**
   * Unregister a bridge for an extension.
   */
  unregisterBridge(extensionId: string): void {
    this.bridges.delete(extensionId);
    this.rateLimiters.delete(extensionId);
  }

  /**
   * Check if a bridge is registered for an extension.
   */
  hasBridge(extensionId: string): boolean {
    return this.bridges.has(extensionId);
  }

  // ---------------------------------------------------------------------------
  // Convenience Methods
  // ---------------------------------------------------------------------------

  /**
   * Forward a selection changed event.
   */
  forwardSelectionChanged(data: SelectionChangedEventData): void {
    this.forward('selectionChanged', data);
  }

  /**
   * Forward a cell changed event.
   */
  forwardCellChanged(data: CellChangedEventData): void {
    this.forward('cellChanged', data);
  }

  /**
   * Forward a cells changed event.
   */
  forwardCellsChanged(data: CellsChangedEventData): void {
    this.forward('cellsChanged', data);
  }

  /**
   * Forward a sheet activated event.
   */
  forwardSheetActivated(data: SheetActivatedEventData): void {
    this.forward('sheetActivated', data);
  }

  /**
   * Forward a sheet added event.
   */
  forwardSheetAdded(data: SheetAddedEventData): void {
    this.forward('sheetAdded', data);
  }

  /**
   * Forward a sheet deleted event.
   */
  forwardSheetDeleted(data: SheetDeletedEventData): void {
    this.forward('sheetDeleted', data);
  }

  /**
   * Forward a sheet renamed event.
   */
  forwardSheetRenamed(data: SheetRenamedEventData): void {
    this.forward('sheetRenamed', data);
  }

  /**
   * Forward a chart selected event.
   */
  forwardChartSelected(data: ChartSelectedEventData): void {
    this.forward('chartSelected', data);
  }

  /**
   * Forward a chart updated event.
   */
  forwardChartUpdated(data: ChartUpdatedEventData): void {
    this.forward('chartUpdated', data);
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get forwarding statistics.
   */
  getStats(): EventForwarderStats {
    return { ...this.stats, eventsByType: { ...this.stats.eventsByType } };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      eventsReceived: 0,
      eventsForwarded: 0,
      eventsNoSubscribers: 0,
      eventsRateLimited: 0,
      eventsByType: {},
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Check if the forwarder is destroyed.
   */
  getIsDestroyed(): boolean {
    return this.isDestroyed;
  }

  /**
   * Destroy the forwarder and clean up resources.
   */
  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    // Cancel all pending debounced calls
    for (const timer of this.debouncers.values()) {
      clearTimeout(timer);
    }
    this.debouncers.clear();

    // Clear rate limiters
    this.rateLimiters.clear();

    // Clear bridges
    this.bridges.clear();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new EventForwarder instance.
 */
export function createEventForwarder(options: EventForwarderOptions): EventForwarder {
  return new EventForwarder(options);
}
