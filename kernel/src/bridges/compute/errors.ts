/**
 * Compute-bridge local errors.
 *
 * Errors specific to ComputeCore that don't fit the kernel-level
 * `BridgeError` (`@kernel/errors/bridge`) or transport-level `TransportError`
 * (`@mog/transport`) shapes. Kept beside `compute-core.ts` so additions are
 * obviously scoped and don't bloat the global error taxonomy.
 *
 */
import { TransportError, type TrapError } from '@mog/transport';

/**
 * Thrown by `ComputeCore.transport.call(...)` when the underlying WASM
 * module has trapped (a previous call returned a `TrapError`) and recovery
 * is pending.
 *
 * Distinct from `TrapError`:
 * - `TrapError` is the originating wasm32 trap surfaced from the transport
 *   boundary (`infra/transport/src/wasm-transport.ts`).
 * - `ModuleTrappedError` is a "we already know it's dead, don't even try"
 *   short-circuit emitted by `ComputeCore` for queued calls / sibling docs
 *   that race the recovery coordinator.
 *
 * Both extend `TransportError` so existing `instanceof TransportError`
 * catches still work.
 *
 * The `isModuleTrapped` discriminator is a `true` literal so callers can
 * narrow with `if (err.isModuleTrapped)` without an explicit `instanceof`
 * (parallel to `TrapError.isTrap`).
 */
export class ModuleTrappedError extends TransportError {
  readonly isModuleTrapped = true as const;

  /** The originating trap that put the module into the trapped state. */
  readonly originating: TrapError;

  constructor(command: string, originating: TrapError) {
    super(command, `WASM module trapped (originating: ${originating.message})`, {
      cause: originating,
    });
    this.name = 'ModuleTrappedError';
    this.originating = originating;
  }
}
