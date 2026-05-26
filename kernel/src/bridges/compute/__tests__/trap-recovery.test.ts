/**
 * trap-recovery.test.ts
 *
 *
 * ComputeCore observes a `TrapError` from the transport boundary
 * (`infra/transport/src/wasm-transport.ts`) and self-marks as trapped:
 *
 * - `isModuleTrapped` flips `false → true`.
 * - The `transport` getter swaps to a stub that throws
 *   `ModuleTrappedError` on every subsequent call, so the security-
 *   event drain (1Hz polling), viewport-pull manager, and queued
 *   mutations all fast-fail rather than re-firing the trap.
 * - The `ready` promise (if pending) rejects with the trap so
 *   awaiters fail fast instead of hanging until disposal.
 *
 * Tests use a thin inline `BridgeTransport` mock — no real WASM
 * fixture, no `createWasmTransport` round-trip. The auto-marker in
 * the ComputeCore constructor only triggers on `TrapError` (the
 * classified shape produced by wasm-transport's catch block); raw
 * `WebAssembly.RuntimeError` is never seen at the ComputeCore
 * boundary in production. So the test feeds `TrapError` directly.
 */
import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import { TrapError, TransportError } from '@mog/transport';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';

import { ComputeCore } from '../compute-core';
import { ModuleTrappedError } from '../errors';
import { BridgeError } from '../../../errors/bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockContext(): IKernelContext {
  return {
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
  } as any;
}

interface CountingTrapTransport extends BridgeTransport {
  readonly callCount: number;
  reset(): void;
}

/**
 * A mock transport that throws a `TrapError` on every `.call(...)`.
 *
 * Mirrors what `createWasmTransport` produces in production when the
 * underlying WASM raises a `WebAssembly.RuntimeError` with a known
 * trap message — but skips the WASM round-trip for unit-test speed.
 *
 * The synthetic-trap fixture
 * (`infra/transport/src/__tests__/synthetic-trap-transport.ts`)
 * throws raw `WebAssembly.RuntimeError`; that's correct for testing
 * the `wasm-transport` classifier itself, but ComputeCore receives
 * an already-classified transport, so we feed it `TrapError`
 * directly.
 */
function createTrapThrowingTransport(trapMessage = 'unreachable'): CountingTrapTransport {
  let count = 0;
  return {
    async call<T = unknown>(command: string, _args: Record<string, unknown>): Promise<T> {
      count += 1;
      throw new TrapError(command, trapMessage, {
        cause: new WebAssembly.RuntimeError(trapMessage),
      });
    },
    get callCount() {
      return count;
    },
    reset() {
      count = 0;
    },
  };
}

/** Mock transport that returns a fixed value (never throws). */
function createNormalTransport(value: unknown = undefined): BridgeTransport {
  return {
    async call<T = unknown>(): Promise<T> {
      return value as T;
    },
  };
}

function createCore(transport: BridgeTransport): ComputeCore {
  return new ComputeCore(makeMockContext(), 'test-doc', transport);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComputeCore — module-trap observability', () => {
  describe('initial state', () => {
    it('isModuleTrapped is false on a fresh core', () => {
      const core = createCore(createNormalTransport());
      expect(core.isModuleTrapped).toBe(false);
      expect(core.trapError).toBeNull();
    });
  });

  describe('auto-mark on TrapError', () => {
    it('flips isModuleTrapped after a TrapError propagates from transport', async () => {
      const transport = createTrapThrowingTransport('unreachable');
      const core = createCore(transport);

      expect(core.isModuleTrapped).toBe(false);

      // The wrapped transport returns a real Promise that rejects (the
      // wrapper is `async`), so .rejects.toBeInstanceOf works here.
      await expect(core.transport.call('compute_recalc', {})).rejects.toBeInstanceOf(TrapError);

      expect(core.isModuleTrapped).toBe(true);
      expect(core.trapError).not.toBeNull();
      expect(core.trapError).toBeInstanceOf(TrapError);
      expect(core.trapError!.command).toBe('compute_recalc');
      expect(core.trapError!.isTrap).toBe(true);
    });

    it('the ORIGINAL TrapError is preserved (cause chain stays intact)', async () => {
      const transport = createTrapThrowingTransport('memory access out of bounds');
      const core = createCore(transport);

      let caught: unknown;
      try {
        await core.transport.call('compute_init', {});
      } catch (e) {
        caught = e;
      }

      // The first thrown error is the originating TrapError, not a wrapper.
      expect(caught).toBeInstanceOf(TrapError);
      expect((caught as TrapError).message).toContain('memory access out of bounds');
      // And the stored trapError on the core is the SAME instance.
      expect(core.trapError).toBe(caught);
    });
  });

  describe('subsequent calls short-circuit to ModuleTrappedError', () => {
    it('the second call throws ModuleTrappedError without invoking transport', async () => {
      const transport = createTrapThrowingTransport('unreachable');
      const core = createCore(transport);

      // First call: actual TrapError from the (mocked) WASM boundary.
      await expect(core.transport.call('compute_first', {})).rejects.toBeInstanceOf(TrapError);
      expect(transport.callCount).toBe(1);

      // Second call: short-circuit at the ComputeCore transport getter.
      // The trap-stub throws SYNCHRONOUSLY (no Promise), matching the
      // disposed-stub pattern — every generated bridge method gets a
      // clean, immediate, catchable error rather than an async pending
      // task that resolves later. So we use try/catch instead of
      // `.rejects`.
      let secondError: unknown;
      try {
        core.transport.call('compute_second', {});
      } catch (e) {
        secondError = e;
      }
      expect(secondError).toBeInstanceOf(ModuleTrappedError);
      expect(secondError).toBeInstanceOf(TransportError); // subclass preserved
      expect(secondError).not.toBeInstanceOf(TrapError);
      expect((secondError as ModuleTrappedError).isModuleTrapped).toBe(true);
      expect((secondError as ModuleTrappedError).command).toBe('compute_second');

      // Crucial: the original transport's call counter is still 1.
      // The second call short-circuited at the ComputeCore boundary —
      // it never re-fired the trap on the (already-dead) module.
      expect(transport.callCount).toBe(1);
    });

    it('ModuleTrappedError chains the originating TrapError as cause', async () => {
      const transport = createTrapThrowingTransport('divide by zero');
      const core = createCore(transport);

      await expect(core.transport.call('compute_first', {})).rejects.toBeInstanceOf(TrapError);
      const originating = core.trapError!;

      let secondError: unknown;
      try {
        core.transport.call('compute_second', {});
      } catch (e) {
        secondError = e;
      }

      const wrapped = secondError as ModuleTrappedError;
      expect(wrapped.originating).toBe(originating);
      expect((wrapped as Error & { cause?: unknown }).cause).toBe(originating);
      expect(wrapped.message).toContain('divide by zero');
    });
  });

  describe('ready promise rejects on early trap', () => {
    it('a pending `ready` promise rejects with the trap when markModuleTrapped fires', async () => {
      const core = createCore(createNormalTransport());
      const readyPromise = core.ready;

      const trap = new TrapError('compute_init', 'unreachable');
      core.markModuleTrapped(trap);

      await expect(readyPromise).rejects.toBe(trap);
    });

    it('auto-mark via transport rejects ready too', async () => {
      const transport = createTrapThrowingTransport('unreachable');
      const core = createCore(transport);
      const readyPromise = core.ready;

      // Trigger auto-mark.
      await expect(core.transport.call('compute_init', {})).rejects.toBeInstanceOf(TrapError);

      // ready must now be rejected with the same TrapError.
      await expect(readyPromise).rejects.toBeInstanceOf(TrapError);
      await expect(readyPromise).rejects.toBe(core.trapError);
    });
  });

  describe('idempotency', () => {
    it('first trap wins when markModuleTrapped is called twice', () => {
      const core = createCore(createNormalTransport());
      const trap1 = new TrapError('compute_first', 'unreachable');
      const trap2 = new TrapError('compute_second', 'memory access out of bounds');

      core.markModuleTrapped(trap1);
      core.markModuleTrapped(trap2);

      expect(core.trapError).toBe(trap1);
      expect(core.trapError).not.toBe(trap2);
      expect(core.isModuleTrapped).toBe(true);
    });

    it('ready promise is not double-rejected', async () => {
      const core = createCore(createNormalTransport());
      const trap1 = new TrapError('compute_first', 'unreachable');
      const trap2 = new TrapError('compute_second', 'memory access out of bounds');
      const readyPromise = core.ready;

      core.markModuleTrapped(trap1);
      // Second call must not throw or otherwise misbehave.
      expect(() => core.markModuleTrapped(trap2)).not.toThrow();

      await expect(readyPromise).rejects.toBe(trap1);
    });
  });

  describe('onTrap listener registration ', () => {
    it('fires registered listeners exactly once when the trap auto-marks', async () => {
      const transport = createTrapThrowingTransport('unreachable');
      const core = createCore(transport);

      const seen: TrapError[] = [];
      const unsub = core.onTrap((trap) => {
        seen.push(trap);
      });
      expect(seen).toHaveLength(0);

      await expect(core.transport.call('compute_init', {})).rejects.toBeInstanceOf(TrapError);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(core.trapError);

      // The unsubscribe is still callable post-fire (no-op).
      expect(() => unsub()).not.toThrow();
    });

    it('fires multiple listeners in registration order on a single trap', async () => {
      const transport = createTrapThrowingTransport('memory access out of bounds');
      const core = createCore(transport);

      const order: string[] = [];
      core.onTrap(() => order.push('a'));
      core.onTrap(() => order.push('b'));
      core.onTrap(() => order.push('c'));

      await expect(core.transport.call('compute_init', {})).rejects.toBeInstanceOf(TrapError);
      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('a late-registered listener (post-trap) fires synchronously with the existing trap', () => {
      const core = createCore(createNormalTransport());
      const trap = new TrapError('compute_init', 'unreachable');
      core.markModuleTrapped(trap);

      let received: TrapError | null = null;
      const unsub = core.onTrap((t) => {
        received = t;
      });
      expect(received).toBe(trap);

      // The unsubscribe is a no-op for already-fired listeners.
      expect(() => unsub()).not.toThrow();
    });

    it('unsubscribe before trap removes the listener', async () => {
      const transport = createTrapThrowingTransport('unreachable');
      const core = createCore(transport);

      const calls: TrapError[] = [];
      const unsub = core.onTrap((t) => calls.push(t));
      unsub();

      await expect(core.transport.call('compute_init', {})).rejects.toBeInstanceOf(TrapError);
      expect(calls).toHaveLength(0);
    });

    it('a throwing listener does not break sibling listeners', async () => {
      const transport = createTrapThrowingTransport('unreachable');
      const core = createCore(transport);

      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const calls: string[] = [];
        core.onTrap(() => {
          calls.push('a');
          throw new Error('listener bug');
        });
        core.onTrap(() => calls.push('b'));

        await expect(core.transport.call('compute_init', {})).rejects.toBeInstanceOf(TrapError);
        expect(calls).toEqual(['a', 'b']);
      } finally {
        consoleError.mockRestore();
      }
    });

    it('listeners drain on first fire (markModuleTrapped is idempotent on listener dispatch)', () => {
      const core = createCore(createNormalTransport());
      let count = 0;
      core.onTrap(() => {
        count += 1;
      });

      const trap1 = new TrapError('compute_init', 'unreachable');
      const trap2 = new TrapError('compute_recalc', 'memory access out of bounds');
      core.markModuleTrapped(trap1);
      core.markModuleTrapped(trap2);

      expect(count).toBe(1);
    });
  });

  describe('DISPOSED takes precedence', () => {
    it('a disposed-and-trapped core throws BridgeError(BRIDGE_DISPOSED), not ModuleTrappedError', () => {
      const transport = createTrapThrowingTransport('unreachable');
      const core = createCore(transport);

      // Force into both states. Order doesn't matter — disposal wins.
      const trap = new TrapError('compute_x', 'unreachable');
      core.markModuleTrapped(trap);
      (core as any)._phase = 'DISPOSED';

      // The transport getter must short-circuit to the DISPOSED stub,
      // not the trap stub. Disposal is the more-fundamental terminal
      // state — no recovery resurrects a disposed core.
      let caught: unknown;
      try {
        // Note: stub `.call()` throws synchronously (not via Promise rejection)
        // — see the disposed-stub in compute-core.ts. Catch sync.
        core.transport.call('any', {});
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BridgeError);
      expect((caught as BridgeError).code).toBe('BRIDGE_DISPOSED');
      expect(caught).not.toBeInstanceOf(ModuleTrappedError);
    });
  });
});
