/**
 * Event Subscription Manager
 *
 * Manages event subscriptions for extensions. Tracks which extensions
 * subscribe to which events and enforces permission requirements.
 *
 * Features:
 * - Per-extension subscription tracking
 * - Permission validation for event subscriptions
 * - Batch subscribe/unsubscribe operations
 * - Query which extensions subscribe to an event
 *
 * @module extensions/events/EventSubscriptionManager
 */

import { EVENT_PERMISSIONS, FORWARDABLE_EVENTS, type ForwardableEvent } from '../constants';
import type { ExtensionPermission } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a subscription attempt
 */
export interface SubscriptionResult {
  /** Events that were successfully subscribed to */
  subscribed: string[];
  /** Events that were denied due to permissions */
  denied: Array<{
    event: string;
    requiredPermission: ExtensionPermission;
  }>;
  /** Events that are not forwardable (unknown) */
  unknown: string[];
}

/**
 * Options for creating an EventSubscriptionManager
 */
export interface EventSubscriptionManagerOptions {
  /**
   * Callback when a subscription is denied.
   * Useful for logging/auditing.
   */
  onDenied?: (extensionId: string, event: string, requiredPermission: ExtensionPermission) => void;
}

// =============================================================================
// EventSubscriptionManager Class
// =============================================================================

/**
 * Manages event subscriptions for extensions.
 *
 * Usage:
 * ```typescript
 * const manager = new EventSubscriptionManager();
 *
 * // Extension subscribes to events
 * const result = manager.subscribe(
 * 'shortcut-ai',
 * ['selectionChanged', 'cellChanged'],
 * ['selection:read', 'spreadsheet:read']
 * );
 *
 * // Check who's subscribed to an event
 * const subscribers = manager.getSubscribers('selectionChanged');
 *
 * // Unsubscribe
 * manager.unsubscribe('shortcut-ai', ['selectionChanged']);
 * ```
 */
export class EventSubscriptionManager {
  /**
   * Map of extensionId -> Set of subscribed events
   */
  private subscriptions: Map<string, Set<string>> = new Map();

  /**
   * Map of extensionId -> granted permissions (cached for validation)
   */
  private extensionPermissions: Map<string, ExtensionPermission[]> = new Map();

  private onDenied?: (
    extensionId: string,
    event: string,
    requiredPermission: ExtensionPermission,
  ) => void;

  constructor(options: EventSubscriptionManagerOptions = {}) {
    this.onDenied = options.onDenied;
  }

  // ---------------------------------------------------------------------------
  // Extension Registration
  // ---------------------------------------------------------------------------

  /**
   * Register an extension with its granted permissions.
   * Should be called when an extension connects.
   */
  registerExtension(extensionId: string, permissions: ExtensionPermission[]): void {
    this.extensionPermissions.set(extensionId, [...permissions]);
    if (!this.subscriptions.has(extensionId)) {
      this.subscriptions.set(extensionId, new Set());
    }
  }

  /**
   * Unregister an extension and remove all its subscriptions.
   * Should be called when an extension disconnects.
   */
  unregisterExtension(extensionId: string): void {
    this.subscriptions.delete(extensionId);
    this.extensionPermissions.delete(extensionId);
  }

  /**
   * Check if an extension is registered.
   */
  isExtensionRegistered(extensionId: string): boolean {
    return this.extensionPermissions.has(extensionId);
  }

  // ---------------------------------------------------------------------------
  // Subscription Management
  // ---------------------------------------------------------------------------

  /**
   * Subscribe an extension to events.
   * Validates permissions and returns which events were successfully subscribed.
   *
   * @param extensionId - The extension ID
   * @param events - Array of event names to subscribe to
   * @param permissions - Optional permissions to use (if not registered)
   */
  subscribe(
    extensionId: string,
    events: string[],
    permissions?: ExtensionPermission[],
  ): SubscriptionResult {
    const result: SubscriptionResult = {
      subscribed: [],
      denied: [],
      unknown: [],
    };

    // Get or set permissions
    const grantedPermissions = permissions ?? this.extensionPermissions.get(extensionId);
    if (permissions && !this.extensionPermissions.has(extensionId)) {
      this.registerExtension(extensionId, permissions);
    }

    if (!grantedPermissions) {
      // Extension not registered and no permissions provided
      // Treat all events as denied
      for (const event of events) {
        if (this.isForwardableEvent(event)) {
          result.denied.push({
            event,
            requiredPermission: EVENT_PERMISSIONS[event as ForwardableEvent],
          });
        } else {
          result.unknown.push(event);
        }
      }
      return result;
    }

    // Ensure subscription set exists
    if (!this.subscriptions.has(extensionId)) {
      this.subscriptions.set(extensionId, new Set());
    }

    const subs = this.subscriptions.get(extensionId)!;

    for (const event of events) {
      // Check if event is forwardable
      if (!this.isForwardableEvent(event)) {
        result.unknown.push(event);
        continue;
      }

      // Check permission
      const requiredPermission = EVENT_PERMISSIONS[event as ForwardableEvent];
      if (!grantedPermissions.includes(requiredPermission)) {
        this.onDenied?.(extensionId, event, requiredPermission);
        result.denied.push({ event, requiredPermission });
        continue;
      }

      // Subscribe
      subs.add(event);
      result.subscribed.push(event);
    }

    return result;
  }

  /**
   * Unsubscribe an extension from events.
   *
   * @param extensionId - The extension ID
   * @param events - Array of event names to unsubscribe from
   * @returns Array of events that were actually unsubscribed
   */
  unsubscribe(extensionId: string, events: string[]): string[] {
    const subs = this.subscriptions.get(extensionId);
    if (!subs) {
      return [];
    }

    const unsubscribed: string[] = [];
    for (const event of events) {
      if (subs.delete(event)) {
        unsubscribed.push(event);
      }
    }

    return unsubscribed;
  }

  /**
   * Unsubscribe an extension from all events.
   *
   * @param extensionId - The extension ID
   * @returns Array of events that were unsubscribed
   */
  unsubscribeAll(extensionId: string): string[] {
    const subs = this.subscriptions.get(extensionId);
    if (!subs) {
      return [];
    }

    const events = Array.from(subs);
    subs.clear();
    return events;
  }

  // ---------------------------------------------------------------------------
  // Query Methods
  // ---------------------------------------------------------------------------

  /**
   * Get all extensions subscribed to a specific event.
   *
   * @param event - The event name
   * @returns Array of extension IDs subscribed to the event
   */
  getSubscribers(event: string): string[] {
    const subscribers: string[] = [];
    for (const [extensionId, subs] of this.subscriptions.entries()) {
      if (subs.has(event)) {
        subscribers.push(extensionId);
      }
    }
    return subscribers;
  }

  /**
   * Get all events an extension is subscribed to.
   *
   * @param extensionId - The extension ID
   * @returns Array of event names
   */
  getSubscriptions(extensionId: string): string[] {
    const subs = this.subscriptions.get(extensionId);
    return subs ? Array.from(subs) : [];
  }

  /**
   * Check if an extension is subscribed to an event.
   *
   * @param extensionId - The extension ID
   * @param event - The event name
   */
  isSubscribed(extensionId: string, event: string): boolean {
    return this.subscriptions.get(extensionId)?.has(event) ?? false;
  }

  /**
   * Check if an event has any subscribers.
   *
   * @param event - The event name
   */
  hasSubscribers(event: string): boolean {
    for (const subs of this.subscriptions.values()) {
      if (subs.has(event)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get count of subscriptions per event.
   */
  getSubscriptionCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const subs of this.subscriptions.values()) {
      for (const event of subs) {
        counts.set(event, (counts.get(event) ?? 0) + 1);
      }
    }
    return counts;
  }

  // ---------------------------------------------------------------------------
  // Event Validation
  // ---------------------------------------------------------------------------

  /**
   * Check if an event is forwardable.
   */
  isForwardableEvent(event: string): event is ForwardableEvent {
    return (FORWARDABLE_EVENTS as readonly string[]).includes(event);
  }

  /**
   * Get the permission required for an event.
   * Returns undefined if the event is not forwardable.
   */
  getRequiredPermission(event: string): ExtensionPermission | undefined {
    if (this.isForwardableEvent(event)) {
      return EVENT_PERMISSIONS[event];
    }
    return undefined;
  }

  /**
   * Get all forwardable events.
   */
  getForwardableEvents(): ForwardableEvent[] {
    return [...FORWARDABLE_EVENTS];
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Clear all subscriptions and registered extensions.
   */
  clear(): void {
    this.subscriptions.clear();
    this.extensionPermissions.clear();
  }

  /**
   * Get statistics about current subscriptions.
   */
  getStats(): {
    extensionCount: number;
    totalSubscriptions: number;
    subscriptionsByEvent: Record<string, number>;
  } {
    let totalSubscriptions = 0;
    const subscriptionsByEvent: Record<string, number> = {};

    for (const subs of this.subscriptions.values()) {
      totalSubscriptions += subs.size;
      for (const event of subs) {
        subscriptionsByEvent[event] = (subscriptionsByEvent[event] ?? 0) + 1;
      }
    }

    return {
      extensionCount: this.subscriptions.size,
      totalSubscriptions,
      subscriptionsByEvent,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new EventSubscriptionManager instance.
 */
export function createEventSubscriptionManager(
  options: EventSubscriptionManagerOptions = {},
): EventSubscriptionManager {
  return new EventSubscriptionManager(options);
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultManager: EventSubscriptionManager | null = null;

/**
 * Get the default EventSubscriptionManager instance (singleton).
 */
export function getDefaultEventSubscriptionManager(): EventSubscriptionManager {
  if (!defaultManager) {
    defaultManager = new EventSubscriptionManager();
  }
  return defaultManager;
}

/**
 * Reset the default manager (for testing).
 */
export function resetDefaultEventSubscriptionManager(): void {
  defaultManager?.clear();
  defaultManager = null;
}
