/**
 * Focus Capability Implementation
 *
 * Provides the ISheetViewFocus capability interface.
 * Delegates to DOM operations on the SheetView container element.
 *
 * @module @mog-sdk/sheet-view/capabilities/focus
 */

import type { ISheetViewFocus } from '../capability-interfaces';

// =============================================================================
// Internal accessor type
// =============================================================================

export interface FocusInternals {
  getContainer(): HTMLElement;
}

// =============================================================================
// Implementation
// =============================================================================

export class SheetViewFocus implements ISheetViewFocus {
  constructor(private readonly _internals: FocusInternals) {}

  focus(): void {
    const container = this._internals.getContainer();
    // Make the container focusable if it isn't already.
    if (!container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }
    container.focus();
  }

  blur(): void {
    const container = this._internals.getContainer();
    container.blur();
  }

  containsActiveElement(): boolean {
    const container = this._internals.getContainer();
    const activeEl = document.activeElement;
    if (!activeEl) return false;
    return container === activeEl || container.contains(activeEl);
  }
}
