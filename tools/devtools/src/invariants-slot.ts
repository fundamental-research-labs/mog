/**
 * — invariant runner slot.
 *
 * Devtools owns the `__dt.invariants()` slot but does NOT own the
 * registry implementation (which lives in
 * `dev/app-eval/capture/invariants/registry.ts`). To avoid a layering
 * inversion (devtools depending on app-eval), the runner is installed at
 * runtime: the registry module imports this slot module, calls
 * `setInvariantsRunner(...)` once it has loaded its registrations, and
 * `__dt.invariants()` delegates here.
 *
 * Until a runner is installed, `__dt.invariants()` returns an empty
 * passing result — Stage A behavior — so callers (snapshot capture,
 * tests) can rely on the shape unconditionally.
 */
import type { InvariantsRunOutput } from './types';

const EMPTY: InvariantsRunOutput = {
  results: [],
  passed: 0,
  failed: 0,
  skipped: 0,
  durationMs: 0,
};

let runner: () => InvariantsRunOutput = () => EMPTY;

/**
 * Install the runner. The registry module calls this after loading its
 * registrations. Idempotent: later calls replace earlier ones (matches
 * the registry's last-wins semantics for individual invariants).
 */
export function setInvariantsRunner(fn: () => InvariantsRunOutput): void {
  runner = fn;
}

/** Called from the `__dt.invariants()` slot in `console/api.ts`. */
export function runInstalledInvariants(): InvariantsRunOutput {
  return runner();
}
