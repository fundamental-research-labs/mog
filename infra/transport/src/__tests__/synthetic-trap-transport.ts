/**
 * Synthetic-trap mock transport — for unit/integration tests that need to
 * simulate a `WebAssembly.RuntimeError` without spinning up a real WASM
 * module. Cheap, fast, deterministic.
 *
 * Pair with `test-fixtures/synthetic-trap/loader.ts` when a test must
 * confirm the real V8/JIT trap-message strings (which are the source of
 * truth for the trap-detection classifier).
 *
 * Usage:
 * ```ts
 * import { createSyntheticTrapTransport } from './synthetic-trap-transport';
 *
 * const transport = createSyntheticTrapTransport({
 *   trapAfter: 3,           // trap on the 3rd call
 *   trapOnCommand: 'compute_recalc', // restrict the trap to a specific command
 *   trapMessage: 'memory access out of bounds',
 * });
 * await transport.call('compute_init', { docId: 'd' });   // ok
 * await transport.call('compute_recalc', { docId: 'd' }); // ok (count=2)
 * await transport.call('compute_recalc', { docId: 'd' }); // throws RuntimeError
 * ```
 *
 * The thrown error is a real `WebAssembly.RuntimeError` instance so
 * `instanceof WebAssembly.RuntimeError` checks in the classifier work.
 */
import type { BridgeTransport } from '../types';

export interface SyntheticTrapConfig {
  /**
   * Throw the trap on the Nth matching call (1-indexed).
   * Default: 1 (trap on the first matching call).
   */
  trapAfter?: number;

  /**
   * Restrict the trap to calls of this command name. When unset, every
   * call counts toward `trapAfter`. When set, only calls matching this
   * command count, and other commands return `defaultResult` regardless
   * of position.
   */
  trapOnCommand?: string;

  /**
   * The `.message` on the thrown `WebAssembly.RuntimeError`.
   * Default: `'unreachable'`. Use `'memory access out of bounds'`,
   * `'divide by zero'`, etc. to simulate other trap classes.
   */
  trapMessage?: string;

  /**
   * Synchronous return value for non-trapping calls. Defaults to `undefined`.
   * Tests that need different responses per command should compose this
   * helper with their own routing logic.
   */
  defaultResult?: unknown;
}

export interface SyntheticTrapTransport extends BridgeTransport {
  /** Total `call(...)` invocations (across all commands). */
  readonly callCount: number;
  /** Calls that matched `trapOnCommand` (or all calls if it's unset). */
  readonly matchingCount: number;
  /** Reset counters so the next call starts at 1. */
  reset(): void;
}

/**
 * Build a `BridgeTransport` that throws a real `WebAssembly.RuntimeError`
 * on a configurable Nth call. Used by trap-recovery tests to simulate
 * traps without loading a real fixture (which can take minutes per trap).
 */
export function createSyntheticTrapTransport(
  config: SyntheticTrapConfig = {},
): SyntheticTrapTransport {
  const trapAfter = config.trapAfter ?? 1;
  const trapMessage = config.trapMessage ?? 'unreachable';
  const trapOnCommand = config.trapOnCommand;
  const defaultResult = config.defaultResult;

  let callCount = 0;
  let matchingCount = 0;

  return {
    async call<T = unknown>(command: string, _args: Record<string, unknown>): Promise<T> {
      callCount += 1;
      const matches = trapOnCommand === undefined || trapOnCommand === command;
      if (matches) {
        matchingCount += 1;
        if (matchingCount >= trapAfter) {
          // Real WebAssembly.RuntimeError instance — necessary for the
          // classifier's `instanceof WebAssembly.RuntimeError` check.
          throw new WebAssembly.RuntimeError(trapMessage);
        }
      }
      return defaultResult as T;
    },
    get callCount() {
      return callCount;
    },
    get matchingCount() {
      return matchingCount;
    },
    reset() {
      callCount = 0;
      matchingCount = 0;
    },
  };
}
