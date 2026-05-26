/**
 * InputSimulator - Headless test harness for the InputSystem.
 *
 * Wraps InputSystem with ergonomic helpers for testing.
 * No DOM, no Canvas, no React. Pure state machine testing.
 *
 * @see systems/grid-editing/testing/grid-simulator.ts for prior art
 */

import type { FocusLayerType, FocusSnapshot } from '@mog-sdk/contracts/machines';
import { InputSystem } from '../input-system';
import type { PaneType } from '../machines/pane-focus-machine';
import type { InputSystemConfig } from '../types';

export class InputSimulator {
  readonly system: InputSystem;

  constructor(config: Partial<InputSystemConfig> = {}) {
    this.system = new InputSystem(config as InputSystemConfig);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    this.system.start();
  }

  dispose(): void {
    this.system.dispose();
  }

  // ===========================================================================
  // Accessors
  // ===========================================================================

  /** Check if the pane focus actor is in a running state */
  isStarted(): boolean {
    const snapshot = this.system.access.actors.paneFocus.getSnapshot();
    return snapshot.status === 'active';
  }

  /** Get the current pane focus state */
  paneFocusState(): PaneType {
    const snapshot = this.system.access.actors.paneFocus.getSnapshot();
    return snapshot.context.currentPane;
  }

  // ===========================================================================
  // Focus helpers (delegate to system)
  // ===========================================================================

  pushFocusLayer(type: FocusLayerType, id: string): void {
    this.system.pushFocusLayer(type, id);
  }

  popFocusLayer(): void {
    this.system.popFocusLayer();
  }

  shouldGridHandleKeyboard(): boolean {
    return this.system.shouldGridHandleKeyboard();
  }

  getFocusSnapshot(): FocusSnapshot {
    return this.system.getFocusSnapshot();
  }
}
