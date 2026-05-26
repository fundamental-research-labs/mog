/**
 * WriteGate — controls mutation admission during lifecycle transitions.
 *
 * Modes:
 *   - `open`:          Normal operation. All mutations pass.
 *   - `checkpointing`: A checkpoint is in progress. Public mutations are
 *                       rejected (the checkpoint captures a consistent
 *                       high-water mark). System bypass scopes still pass.
 *   - `closing`:       Document is shutting down. All public mutations are
 *                       rejected; only bypass-scoped system operations pass.
 *   - `closed`:        Terminal. Everything rejected, including bypass.
 *
 * Bypass scopes:
 *   Provider replay and import hydration need to write into the engine while
 *   the gate would otherwise block (e.g. encoding full state during
 *   checkpoint). A bypass scope increments a depth counter; the gate allows
 *   writes while depth > 0 regardless of mode (except `closed`).
 *
 * High-water-mark snapshot (High-water-mark):
 *   `captureHighWaterMark()` snapshots the current watermark + provider
 *   origin state for use by the proof registry. `recordMutation()` is an
 *   alias for `advanceWatermark()` used by the HWM test surface.
 *
 * The lifecycle system maps its phases to gate modes via PHASE_TO_GATE_MODE.
 */

import type { HighWaterMarkSnapshot } from '@mog-sdk/contracts/storage';
import { KernelError } from '../errors/kernel-error';

// =============================================================================
// Types
// =============================================================================

export type GateMode = 'open' | 'checkpointing' | 'closing' | 'closed';

export interface CheckpointResult {
  /** The high-water mark (monotonic sequence) that was made durable. */
  durableWatermark: number;
  /** Modes the gate transitioned through: [previous, 'checkpointing', restored]. */
  modeTransitions: GateMode[];
}

export interface CloseResult {
  /** Final durability status from all providers. */
  durable: boolean;
  /** Number of mutations that drained before close completed. */
  drainedCount: number;
  /** The watermark at close time. */
  finalWatermark: number;
}

/**
 * Maps lifecycle phases to the gate mode they require.
 */
export const PHASE_TO_GATE_MODE: Record<string, GateMode> = {
  idle: 'closed',
  creating: 'open',
  wiring: 'open',
  starting: 'open',
  hydrating: 'open',
  attaching: 'open',
  ready: 'open',
  disposing: 'closing',
  disposed: 'closed',
  error: 'closed',
};

// =============================================================================
// WriteGate
// =============================================================================

export class WriteGate {
  private _mode: GateMode = 'open';
  private _watermark = 0;
  private _bypassDepth = 0;
  private _previousMode: GateMode | null = null;
  private _drainedDuringClose = 0;
  private _inboundBarrierActive = false;

  get mode(): GateMode {
    return this._mode;
  }

  get watermark(): number {
    return this._watermark;
  }

  get bypassDepth(): number {
    return this._bypassDepth;
  }

  // ---------------------------------------------------------------------------
  // High-water-mark: HWM snapshot surface
  // ---------------------------------------------------------------------------

  get currentWatermark(): number {
    return this._watermark;
  }

  get inboundBarrierActive(): boolean {
    return this._inboundBarrierActive;
  }

  setInboundBarrier(active: boolean): void {
    this._inboundBarrierActive = active;
  }

  /**
   * Alias for advanceWatermark — used by the HWM proof tests.
   * Called by the orchestrator on every fanned-out update_v1 payload.
   */
  recordMutation(): void {
    this.advanceWatermark();
  }

  /**
   * Capture a high-water-mark snapshot for the proof registry.
   */
  captureHighWaterMark(
    providerOriginWatermarks: Record<string, number> = {},
    pendingAssetCount = 0,
  ): HighWaterMarkSnapshot {
    return {
      mutationWatermark: this._watermark,
      providerOriginWatermarks: { ...providerOriginWatermarks },
      inboundBarrierActive: this._inboundBarrierActive,
      pendingAssetCount,
    };
  }

  /**
   * Assert that a mutation is allowed. Throws if the gate blocks the
   * operation (used by ComputeCore.mutateCore for fail-fast checks).
   */
  assertWritable(operation: string): void {
    if (!this.allowsPublicMutation()) {
      throw new KernelError(
        'SCENARIO_ACTIVE_STATE_READ_ONLY',
        `Write rejected: document is in '${this._mode}' mode. ` +
          `Operation '${operation}' cannot proceed.`,
        {
          context: {
            operation,
            mode: this._mode,
            bypassDepth: this._bypassDepth,
          },
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Watermark admission: Watermark + mutation admission
  // ---------------------------------------------------------------------------

  /**
   * Advance the watermark. Called by the orchestrator each time a mutation
   * is accepted (i.e. fanned out to providers).
   */
  advanceWatermark(): number {
    return ++this._watermark;
  }

  /**
   * Whether a public (non-bypass) mutation should be admitted right now.
   */
  allowsPublicMutation(): boolean {
    if (this._mode === 'closed') return false;
    if (this._mode === 'open') return true;
    return this._bypassDepth > 0;
  }

  /**
   * Whether a system operation under a bypass scope is admitted.
   */
  allowsBypassMutation(): boolean {
    if (this._mode === 'closed') return false;
    return this._bypassDepth > 0;
  }

  // ---------------------------------------------------------------------------
  // Mode transitions
  // ---------------------------------------------------------------------------

  /**
   * Enter checkpointing mode. Captures the current watermark as the
   * high-water mark the checkpoint targets. Returns the captured watermark.
   */
  enterCheckpointing(): number {
    if (this._mode === 'closed') {
      throw new Error('WriteGate: cannot enter checkpointing from closed');
    }
    this._previousMode = this._mode;
    this._mode = 'checkpointing';
    return this._watermark;
  }

  /**
   * Leave checkpointing mode. Restores the mode that was active before
   * `enterCheckpointing()`.
   */
  leaveCheckpointing(): void {
    if (this._mode !== 'checkpointing') return;
    this._mode = this._previousMode ?? 'open';
    this._previousMode = null;
  }

  enterClosing(): void {
    if (this._mode === 'closed') return;
    this._previousMode = this._mode;
    this._mode = 'closing';
    this._drainedDuringClose = 0;
  }

  enterClosed(): void {
    this._mode = 'closed';
    this._bypassDepth = 0;
  }

  recordDrain(): void {
    this._drainedDuringClose++;
  }

  get drainedDuringClose(): number {
    return this._drainedDuringClose;
  }

  /**
   * Transition to an arbitrary mode. Used by the lifecycle system when
   * mapping phases via PHASE_TO_GATE_MODE.
   */
  setMode(mode: GateMode): void {
    this._mode = mode;
  }

  // ---------------------------------------------------------------------------
  // Bypass scope
  // ---------------------------------------------------------------------------

  enterBypass(): void {
    this._bypassDepth++;
  }

  leaveBypass(): void {
    if (this._bypassDepth > 0) this._bypassDepth--;
  }

  /**
   * Run `fn` inside a bypass scope. The scope is left even if `fn` throws.
   */
  async withBypass<T>(fn: () => Promise<T>): Promise<T> {
    this.enterBypass();
    try {
      return await fn();
    } finally {
      this.leaveBypass();
    }
  }

  withBypassSync<T>(fn: () => T): T {
    this.enterBypass();
    try {
      return fn();
    } finally {
      this.leaveBypass();
    }
  }
}
