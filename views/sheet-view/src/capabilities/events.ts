/**
 * Events Capability Implementation
 *
 * Provides the ISheetViewEvents capability interface.
 *
 * Events are emitted by the SheetView class at well-defined points:
 * - Scroll changes
 * - Zoom changes
 * - Visible range changes
 * - Geometry changes
 * - Focus enter/leave
 *
 * The SheetView class calls emitEvent() on this capability when
 * internal state changes occur.
 *
 * @module @mog-sdk/sheet-view/capabilities/events
 */

import type { ISheetViewEvents } from '../capability-interfaces';
import type { SheetDisposable, SheetViewEvent } from '../public-types';

// =============================================================================
// Implementation
// =============================================================================

export class SheetViewEvents implements ISheetViewEvents {
  private _listeners: Set<(event: SheetViewEvent) => void> = new Set();

  subscribe(listener: (event: SheetViewEvent) => void): SheetDisposable {
    this._listeners.add(listener);
    return {
      dispose: () => {
        this._listeners.delete(listener);
      },
    };
  }

  /**
   * Emit an event to all subscribers.
   * Called internally by SheetView — not part of the public interface.
   */
  emit(event: SheetViewEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // Swallow subscriber errors to avoid breaking the event loop.
      }
    }
  }

  /** Remove all subscribers (called on dispose). */
  clear(): void {
    this._listeners.clear();
  }
}
